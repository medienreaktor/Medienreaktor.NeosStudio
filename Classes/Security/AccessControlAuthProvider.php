<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Security;

use Medienreaktor\NeosStudio\Domain\Model\EffectiveAccess;
use Medienreaktor\NeosStudio\Service\AccessControlService;
use Neos\ContentRepository\Core\CommandHandler\CommandInterface;
use Neos\ContentRepository\Core\Feature\NodeCreation\Command\CreateNodeAggregateWithNode;
use Neos\ContentRepository\Core\Feature\NodeModification\Command\SetNodeProperties;
use Neos\ContentRepository\Core\Feature\NodeMove\Command\MoveNodeAggregate;
use Neos\ContentRepository\Core\Feature\NodeRenaming\Command\ChangeNodeAggregateName;
use Neos\ContentRepository\Core\Feature\NodeTypeChange\Command\ChangeNodeAggregateType;
use Neos\ContentRepository\Core\Feature\NodeReferencing\Command\SetNodeReferences;
use Neos\ContentRepository\Core\Feature\NodeRemoval\Command\RemoveNodeAggregate;
use Neos\ContentRepository\Core\Feature\NodeVariation\Command\CreateNodeVariant;
use Neos\ContentRepository\Core\Feature\Security\AuthProviderInterface;
use Neos\ContentRepository\Core\Feature\Security\Dto\Privilege;
use Neos\ContentRepository\Core\Feature\Security\Dto\UserId as ContentRepositoryUserId;
use Neos\ContentRepository\Core\Feature\SubtreeTagging\Command\TagSubtree;
use Neos\ContentRepository\Core\Feature\SubtreeTagging\Command\UntagSubtree;
use Neos\ContentRepository\Core\Feature\WorkspaceCreation\Command\CreateWorkspace;
use Neos\ContentRepository\Core\Feature\WorkspaceModification\Command\ChangeBaseWorkspace;
use Neos\ContentRepository\Core\Feature\WorkspacePublication\Command\PublishIndividualNodesFromWorkspace;
use Neos\ContentRepository\Core\Feature\WorkspacePublication\Command\PublishWorkspace;
use Neos\ContentRepository\Core\Projection\ContentGraph\ContentGraphReadModelInterface;
use Neos\ContentRepository\Core\Projection\ContentGraph\VisibilityConstraints;
use Neos\ContentRepository\Core\SharedModel\ContentRepository\ContentRepositoryId;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAddress;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAggregateId;
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\Flow\Log\Utility\LogEnvironment;
use Neos\Neos\Domain\Service\WorkspaceService;
use Neos\Neos\Domain\SubtreeTagging\NeosSubtreeTag;
use Psr\Log\LoggerInterface;

/**
 * Content repository authorization narrowed by the Studio's dynamic access
 * roles: everything Neos decides stays decided by Neos, this only ever says
 * "no" on top.
 *
 * It wraps (never replaces) the core's ContentRepositoryAuthProvider and asks
 * it first. A command the core denies is denied, full stop; a command the core
 * grants is then checked against the acting user's roles - the site and page
 * branch the target node lives in, the dimension it is being written in, the
 * workspace it belongs to, and the coarse capability the command represents
 * (edit / create / delete / move).
 *
 * Only ever narrowing means this cannot grant anyone anything, which is what
 * makes it safe to sit in the write path of every editor. Its own errors fail
 * CLOSED: a restriction check that cannot complete (a node or workspace that
 * will not resolve) denies with a reason and is logged - otherwise any error
 * in resolving the node would be a way around the roles.
 *
 * Reading and working in a workspace are asked separately, and live is the
 * reason why. Root workspaces stay READABLE for everyone: the frontend
 * renders from live, so cutting it off would take the website down for the
 * very people the role is meant to shape. Working in one is a different
 * question and gets no such exemption - "restricted to Entwurf" has to also
 * mean "cannot simply switch back to live and edit there", including via the
 * base-workspace retargeting the Studio's workspace switcher performs.
 *
 * @internal
 */
final readonly class AccessControlAuthProvider implements AuthProviderInterface
{
    public function __construct(
        private ContentRepositoryId $contentRepositoryId,
        private AuthProviderInterface $delegate,
        private ContentGraphReadModelInterface $contentGraphReadModel,
        private AccessControlService $accessControlService,
        private WorkspaceService $workspaceService,
        private LoggerInterface $logger,
    ) {
    }

    public function getAuthenticatedUserId(): ?ContentRepositoryUserId
    {
        return $this->delegate->getAuthenticatedUserId();
    }

    public function getVisibilityConstraints(WorkspaceName $workspaceName): VisibilityConstraints
    {
        return $this->delegate->getVisibilityConstraints($workspaceName);
    }

    public function canReadNodesFromWorkspace(WorkspaceName $workspaceName): Privilege
    {
        $privilege = $this->delegate->canReadNodesFromWorkspace($workspaceName);
        if (!$privilege->granted) {
            return $privilege;
        }
        $access = $this->access();
        if ($access === null) {
            return $privilege;
        }
        try {
            $classification = $this->classificationOf($workspaceName);
        } catch (\Throwable $e) {
            return $this->failedCheck($e, sprintf('reading workspace "%s"', $workspaceName->value));
        }
        if (!$access->allowsWorkspaceRead($workspaceName->value, $classification)) {
            return Privilege::denied(sprintf('Workspace "%s" is not part of your access role(s)', $workspaceName->value));
        }

        return $privilege;
    }

    public function canExecuteCommand(CommandInterface $command): Privilege
    {
        $privilege = $this->delegate->canExecuteCommand($command);
        if (!$privilege->granted) {
            return $privilege;
        }
        $access = $this->access();
        if ($access === null) {
            return $privilege;
        }

        try {
            $denial = $this->denialFor($command, $access);
        } catch (\Throwable $e) {
            // A restriction check that cannot complete must not let the
            // command through - the roles would be one exception away from
            // meaning nothing.
            return $this->failedCheck($e, sprintf('command "%s"', (new \ReflectionClass($command))->getShortName()));
        }

        return $denial ?? $privilege;
    }

    /**
     * The one place the extra rules live. Returns the denial, or null when
     * the roles have nothing to object to.
     */
    private function denialFor(CommandInterface $command, EffectiveAccess $access): ?Privilege
    {
        // Every command carrying a workspace is bound by the workspace rules -
        // the EDITING ones, which unlike reading give live no exemption.
        $workspaceName = $this->workspaceNameOf($command);
        if ($workspaceName !== null && !$this->allowsEditingIn($access, $workspaceName)) {
            return Privilege::denied(sprintf('Workspace "%s" is not part of your access role(s)', $workspaceName->value));
        }

        if ($command instanceof CreateWorkspace) {
            if (!$access->allowsWorkspaceCreation()) {
                return Privilege::denied('Your access role(s) do not allow creating workspaces');
            }
            if (!$this->allowsEditingIn($access, $command->baseWorkspaceName)) {
                return Privilege::denied(sprintf('Base workspace "%s" is not part of your access role(s)', $command->baseWorkspaceName->value));
            }
        }

        // Retargeting where a publish goes is how the Studio's switcher
        // "changes workspace" - so the NEW BASE has to be one the roles cover,
        // or "restricted to Entwurf" is one dropdown entry away from meaning
        // nothing.
        if ($command instanceof ChangeBaseWorkspace && !$this->allowsEditingIn($access, $command->baseWorkspaceName)) {
            return Privilege::denied(sprintf('Base workspace "%s" is not part of your access role(s)', $command->baseWorkspaceName->value));
        }

        if (($command instanceof PublishWorkspace || $command instanceof PublishIndividualNodesFromWorkspace)
            && $this->publishesIntoRootWorkspace($command->workspaceName)
            && !$access->allowsPublishToLive()
        ) {
            return Privilege::denied('Your access role(s) do not allow publishing to live');
        }

        foreach ($this->nodeRequirementsOf($command) as [$address, $capability]) {
            $denial = $this->denialForNode($access, $address, $capability);
            if ($denial !== null) {
                return $denial;
            }
        }

        return null;
    }

    /**
     * One node-level requirement: may the acting user perform $capability on
     * the node at $address?
     */
    private function denialForNode(EffectiveAccess $access, NodeAddress $address, string $capability): ?Privilege
    {
        $subgraph = $this->contentGraphReadModel
            ->getContentGraph($address->workspaceName)
            ->getSubgraph($address->dimensionSpacePoint, VisibilityConstraints::createEmpty());
        [$idPath, $siteNodeName] = $this->accessControlService->nodeContext($subgraph, $address->aggregateId);
        $coordinates = $address->dimensionSpacePoint->coordinates;
        $classification = $this->classificationOf($address->workspaceName);

        // ONE role has to permit all of it. Asking the axes separately and
        // OR-ing each across the roles would let a role granting only the
        // workspace combine with one granting only the writing.
        if ($access->permits($siteNodeName, $idPath, $coordinates, $address->workspaceName->value, $classification, $capability)) {
            return null;
        }

        return Privilege::denied($this->explainDenial(
            $access,
            $siteNodeName,
            $idPath,
            $coordinates,
            $address,
            $classification,
            $capability
        ));
    }

    /**
     * Why the operation was refused. The decision above is one conjunction, so
     * naming a reason means asking the axes again - purely to say something
     * more useful than "not allowed". The first axis no role satisfies at all
     * is the closest thing to a cause; when every axis is individually fine
     * the roles simply do not line up, and that is worth saying too.
     *
     * @param array<int, string> $idPath
     * @param array<string, string> $coordinates
     */
    private function explainDenial(
        EffectiveAccess $access,
        string $siteNodeName,
        array $idPath,
        array $coordinates,
        NodeAddress $address,
        string $classification,
        string $capability,
    ): string {
        if ($capability !== '' && !$access->allowsCapability($capability)) {
            return sprintf('Your access role(s) do not allow the "%s" capability', $capability);
        }
        if (!$access->allowsWorkspaceEditing($address->workspaceName->value, $classification)) {
            return sprintf('Workspace "%s" is not part of your access role(s)', $address->workspaceName->value);
        }
        if ($coordinates !== [] && !$access->allowsDimensionSpacePoint($coordinates)) {
            return sprintf('Dimension "%s" is not part of your access role(s)', $address->dimensionSpacePoint->toJson());
        }
        if ($idPath !== [] && !$access->allowsNode($idPath, $siteNodeName)) {
            return sprintf('Node "%s" is outside the page tree your access role(s) cover', $address->aggregateId->value);
        }

        return sprintf(
            'No single access role of yours covers this operation on node "%s" (workspace "%s")',
            $address->aggregateId->value,
            $address->workspaceName->value
        );
    }

    /**
     * The nodes a command writes to, each with the capability it represents.
     * Mirrors the core's own command-to-node mapping (which is private) and
     * adds the capability dimension on top - the core knows *whether* a node
     * may be edited, the roles additionally know *what kind* of edit is
     * allowed. It also covers what the core only gates per workspace: a move
     * is a write on the new parent too, and renaming / retyping an aggregate
     * writes to it in every dimension it covers.
     *
     * Keep in step with the shell (features/tree/treeDnd.ts and the
     * nodePermits() checks of the editing UI).
     *
     * @return list<array{NodeAddress, string}>
     */
    private function nodeRequirementsOf(CommandInterface $command): array
    {
        return match ($command::class) {
            CreateNodeAggregateWithNode::class => [[
                NodeAddress::create($this->contentRepositoryId, $command->workspaceName, $command->originDimensionSpacePoint->toDimensionSpacePoint(), $command->parentNodeAggregateId),
                'createNodes',
            ]],
            CreateNodeVariant::class => [[
                NodeAddress::create($this->contentRepositoryId, $command->workspaceName, $command->sourceOrigin->toDimensionSpacePoint(), $command->nodeAggregateId),
                'createNodes',
            ]],
            RemoveNodeAggregate::class => [[
                NodeAddress::create($this->contentRepositoryId, $command->workspaceName, $command->coveredDimensionSpacePoint, $command->nodeAggregateId),
                'deleteNodes',
            ]],
            // Neos deletes by tagging the subtree as removed (soft removal), so
            // that is a delete; restoring it again stays an edit
            TagSubtree::class => [[
                NodeAddress::create($this->contentRepositoryId, $command->workspaceName, $command->coveredDimensionSpacePoint, $command->nodeAggregateId),
                $command->tag->equals(NeosSubtreeTag::removed()) ? 'deleteNodes' : 'editNodes',
            ]],
            UntagSubtree::class => [[
                NodeAddress::create($this->contentRepositoryId, $command->workspaceName, $command->coveredDimensionSpacePoint, $command->nodeAggregateId),
                'editNodes',
            ]],
            MoveNodeAggregate::class => $this->moveRequirementsOf($command),
            SetNodeProperties::class => [[
                NodeAddress::create($this->contentRepositoryId, $command->workspaceName, $command->originDimensionSpacePoint->toDimensionSpacePoint(), $command->nodeAggregateId),
                'editNodes',
            ]],
            SetNodeReferences::class => [[
                NodeAddress::create($this->contentRepositoryId, $command->workspaceName, $command->sourceOriginDimensionSpacePoint->toDimensionSpacePoint(), $command->sourceNodeAggregateId),
                'editNodes',
            ]],
            ChangeNodeAggregateType::class, ChangeNodeAggregateName::class => $this->aggregateRequirementsOf($command->workspaceName, $command->nodeAggregateId, 'editNodes'),
            default => [],
        };
    }

    /**
     * A move writes to the node (moveNodes) and to the parent it ends up
     * under, which gains a child (createNodes) - the same pair the tree's drag
     * and drop checks before it lets a drop happen.
     *
     * Without a new parent the content repository keeps the current one (the
     * given siblings then have to be current siblings), so that parent is the
     * one gaining the child: a reorder via the API is held to the same rule as
     * a reorder via the tree, which always names the parent.
     *
     * @return list<array{NodeAddress, string}>
     */
    private function moveRequirementsOf(MoveNodeAggregate $command): array
    {
        $requirements = [[
            NodeAddress::create($this->contentRepositoryId, $command->workspaceName, $command->dimensionSpacePoint, $command->nodeAggregateId),
            'moveNodes',
        ]];
        $parentId = $command->newParentNodeAggregateId
            ?? $this->contentGraphReadModel
                ->getContentGraph($command->workspaceName)
                ->getSubgraph($command->dimensionSpacePoint, VisibilityConstraints::createEmpty())
                ->findParentNode($command->nodeAggregateId)
                ?->aggregateId;
        if ($parentId === null) {
            // Neither named nor resolvable: nothing is being moved (the node
            // does not exist here, or is a root) - the handler refuses it.
            return $requirements;
        }
        $requirements[] = [
            NodeAddress::create($this->contentRepositoryId, $command->workspaceName, $command->dimensionSpacePoint, $parentId),
            'createNodes',
        ];

        return $requirements;
    }

    /**
     * Renaming or retyping is aggregate-wide - it carries no dimension because
     * it changes the node in all of them, so the roles have to permit it in
     * every dimension space point the aggregate covers.
     *
     * @return list<array{NodeAddress, string}>
     */
    private function aggregateRequirementsOf(WorkspaceName $workspaceName, NodeAggregateId $nodeAggregateId, string $capability): array
    {
        $nodeAggregate = $this->contentGraphReadModel
            ->getContentGraph($workspaceName)
            ->findNodeAggregateById($nodeAggregateId);
        if ($nodeAggregate === null) {
            // Nothing to write to - the handler refuses the command itself.
            return [];
        }
        $requirements = [];
        foreach ($nodeAggregate->coveredDimensionSpacePoints as $dimensionSpacePoint) {
            $requirements[] = [
                NodeAddress::create($this->contentRepositoryId, $workspaceName, $dimensionSpacePoint, $nodeAggregateId),
                $capability,
            ];
        }

        return $requirements;
    }

    /**
     * The acting user's restrictions, or null when nothing has to be checked
     * at all (unrestricted user, or enforcement turned off so the roles only
     * shape the Studio's UI).
     */
    private function access(): ?EffectiveAccess
    {
        if (!$this->accessControlService->isEnforcedInContentRepository()) {
            return null;
        }
        $access = $this->accessControlService->effectiveAccessForCurrentUser();

        return $access->unrestricted ? null : $access;
    }

    private function allowsEditingIn(EffectiveAccess $access, WorkspaceName $workspaceName): bool
    {
        return $access->allowsWorkspaceEditing($workspaceName->value, $this->classificationOf($workspaceName));
    }

    private function workspaceNameOf(CommandInterface $command): ?WorkspaceName
    {
        // Almost every content command carries the workspace it acts in; the
        // few that do not (dimension adjustments) are administrative and were
        // already gated by the core.
        return isset($command->workspaceName) && $command->workspaceName instanceof WorkspaceName
            ? $command->workspaceName
            : null;
    }

    /**
     * ROOT, PERSONAL, SHARED or UNKNOWN. A workspace that does not exist (yet -
     * CreateWorkspace names the one it is about to create) is UNKNOWN; any
     * other failure propagates and fails the check closed.
     */
    private function classificationOf(WorkspaceName $workspaceName): string
    {
        if ($this->contentGraphReadModel->findWorkspaceByName($workspaceName) === null) {
            return 'UNKNOWN';
        }

        return $this->workspaceService
            ->getWorkspaceMetadata($this->contentRepositoryId, $workspaceName)
            ->classification->value;
    }

    /**
     * The fail-closed answer to a restriction check that could not complete:
     * denied, with the error logged for whoever has to find out why.
     */
    private function failedCheck(\Throwable $exception, string $subject): Privilege
    {
        $this->logger->error(
            sprintf('Studio access check for %s failed and was denied: %s', $subject, $exception->getMessage()),
            ['exception' => $exception] + LogEnvironment::fromMethodName(__METHOD__)
        );

        return Privilege::denied(sprintf('The access check for %s could not be completed; denied to be safe', $subject));
    }

    private function publishesIntoRootWorkspace(WorkspaceName $workspaceName): bool
    {
        $workspace = $this->contentGraphReadModel->findWorkspaceByName($workspaceName);
        if ($workspace?->baseWorkspaceName === null) {
            return false;
        }
        $baseWorkspace = $this->contentGraphReadModel->findWorkspaceByName($workspace->baseWorkspaceName);

        return $baseWorkspace !== null && $baseWorkspace->isRootWorkspace();
    }
}
