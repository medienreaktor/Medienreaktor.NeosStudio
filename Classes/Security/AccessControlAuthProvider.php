<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Security;

use Medienreaktor\NeosStudio\Domain\Model\EffectiveAccess;
use Medienreaktor\NeosStudio\Service\AccessControlService;
use Neos\ContentRepository\Core\CommandHandler\CommandInterface;
use Neos\ContentRepository\Core\Feature\NodeCreation\Command\CreateNodeAggregateWithNode;
use Neos\ContentRepository\Core\Feature\NodeModification\Command\SetNodeProperties;
use Neos\ContentRepository\Core\Feature\NodeMove\Command\MoveNodeAggregate;
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
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\Neos\Domain\Service\WorkspaceService;

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
 * makes it safe to sit in the write path of every editor. The other half of
 * that safety is failing open on its own errors: an exception while resolving
 * a node or a workspace leaves the core's decision standing rather than
 * blocking an editor over a bug in a restriction check.
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
        if (!$access->allowsWorkspaceRead($workspaceName->value, $this->classificationOf($workspaceName))) {
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
        } catch (\Throwable) {
            // A restriction check that cannot complete must not block an
            // editor - the core already granted this command.
            return $privilege;
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

        $requirement = $this->nodeRequirementOf($command);
        if ($requirement === null) {
            return null;
        }
        [$address, $capability] = $requirement;

        if (!$access->allowsCapability($capability)) {
            return Privilege::denied(sprintf('Your access role(s) do not allow the "%s" capability', $capability));
        }
        if (!$access->allowsDimensionSpacePoint($address->dimensionSpacePoint->coordinates)) {
            return Privilege::denied(sprintf('Dimension "%s" is not part of your access role(s)', $address->dimensionSpacePoint->toJson()));
        }

        $subgraph = $this->contentGraphReadModel
            ->getContentGraph($address->workspaceName)
            ->getSubgraph($address->dimensionSpacePoint, VisibilityConstraints::createEmpty());
        if (!$this->accessControlService->allowsNode($access, $subgraph, $address->aggregateId)) {
            return Privilege::denied(sprintf('Node "%s" is outside the page tree your access role(s) cover', $address->aggregateId->value));
        }

        return null;
    }

    /**
     * The node a command writes to, plus the capability it represents. Mirrors
     * the core's own command-to-node mapping (which is private) and adds the
     * capability dimension on top - the core knows *whether* a node may be
     * edited, the roles additionally know *what kind* of edit is allowed.
     *
     * @return array{NodeAddress, string}|null
     */
    private function nodeRequirementOf(CommandInterface $command): ?array
    {
        return match ($command::class) {
            CreateNodeAggregateWithNode::class => [
                NodeAddress::create($this->contentRepositoryId, $command->workspaceName, $command->originDimensionSpacePoint->toDimensionSpacePoint(), $command->parentNodeAggregateId),
                'createNodes',
            ],
            CreateNodeVariant::class => [
                NodeAddress::create($this->contentRepositoryId, $command->workspaceName, $command->sourceOrigin->toDimensionSpacePoint(), $command->nodeAggregateId),
                'createNodes',
            ],
            RemoveNodeAggregate::class => [
                NodeAddress::create($this->contentRepositoryId, $command->workspaceName, $command->coveredDimensionSpacePoint, $command->nodeAggregateId),
                'deleteNodes',
            ],
            TagSubtree::class, UntagSubtree::class => [
                NodeAddress::create($this->contentRepositoryId, $command->workspaceName, $command->coveredDimensionSpacePoint, $command->nodeAggregateId),
                'editNodes',
            ],
            MoveNodeAggregate::class => [
                NodeAddress::create($this->contentRepositoryId, $command->workspaceName, $command->dimensionSpacePoint, $command->nodeAggregateId),
                'moveNodes',
            ],
            SetNodeProperties::class => [
                NodeAddress::create($this->contentRepositoryId, $command->workspaceName, $command->originDimensionSpacePoint->toDimensionSpacePoint(), $command->nodeAggregateId),
                'editNodes',
            ],
            SetNodeReferences::class => [
                NodeAddress::create($this->contentRepositoryId, $command->workspaceName, $command->sourceOriginDimensionSpacePoint->toDimensionSpacePoint(), $command->sourceNodeAggregateId),
                'editNodes',
            ],
            default => null,
        };
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

    /** ROOT, PERSONAL, SHARED or UNKNOWN - UNKNOWN never restricts. */
    private function classificationOf(WorkspaceName $workspaceName): string
    {
        try {
            return $this->workspaceService
                ->getWorkspaceMetadata($this->contentRepositoryId, $workspaceName)
                ->classification->value;
        } catch (\Throwable) {
            return 'UNKNOWN';
        }
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
