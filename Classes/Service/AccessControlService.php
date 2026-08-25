<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

use Medienreaktor\NeosStudio\Domain\Model\AccessRole;
use Medienreaktor\NeosStudio\Domain\Model\AccessRoleConstraints;
use Medienreaktor\NeosStudio\Domain\Model\EffectiveAccess;
use Medienreaktor\NeosStudio\Domain\Repository\AccessRoleRepository;
use Neos\ContentRepository\Core\Projection\ContentGraph\ContentSubgraphInterface;
use Neos\ContentRepository\Core\Projection\ContentGraph\Filter\FindAncestorNodesFilter;
use Neos\ContentRepository\Core\Projection\ContentGraph\Node;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAggregateClassification;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAggregateId;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\Security\Context as SecurityContext;
use Neos\Flow\Security\Policy\Role;
use Neos\Neos\Domain\Model\UserId;
use Neos\Neos\Domain\Service\UserService;

/**
 * Resolves what the acting user may reach, from the dynamic access roles
 * assigned to them.
 *
 * Two properties this service is built around, both of them deliberate:
 *
 * 1. **It fails open.** Every path that cannot answer the question - no
 *    security context yet, no Neos user behind the account, the tables not
 *    migrated, the database unreachable - returns "unrestricted". This code
 *    sits in front of every content repository write and every Studio
 *    request; a bug here must degrade to "no extra restrictions", never to a
 *    locked-out editorial team.
 *
 * 2. **It is empty by default.** A user with no role assigned is
 *    unrestricted, so installing the feature changes nothing until an
 *    administrator assigns a role. Distributions that want the stricter
 *    reading - "unassigned means no access" - flip
 *    `accessControl.restrictUnassignedUsers`, which turns the absence of a
 *    role into a deny-all instead.
 *
 * The result is memoised per request: authorization asks the same question
 * dozens of times per page and the answer cannot change mid-request.
 */
#[Flow\Scope('singleton')]
class AccessControlService
{
    #[Flow\Inject]
    protected AccessRoleRepository $accessRoleRepository;

    #[Flow\Inject]
    protected UserService $userService;

    #[Flow\Inject]
    protected SecurityContext $securityContext;

    /**
     * @var array{bypassRoles: array<int, string>, restrictUnassignedUsers: bool, enforceContentRepository: bool}
     */
    #[Flow\InjectConfiguration(package: 'Medienreaktor.NeosStudio', path: 'accessControl')]
    protected array $settings = [];

    /**
     * Memoised per request, keyed by user id ('' = no user).
     *
     * @var array<string, EffectiveAccess>
     */
    private array $effectiveAccessCache = [];

    /**
     * Ancestry per node aggregate id, and path anchors per role set. Both are
     * asked once per node of every listing the API serves, and neither can
     * change mid-request - without this a 50-row tree listing would walk the
     * graph 50 times and resolve the anchors 50 times over.
     *
     * @var array<string, array{0: array<int, string>, 1: string}>
     */
    private array $nodeContextCache = [];

    /**
     * @var array<string, array<int, string>>
     */
    private array $pathAnchorCache = [];

    /**
     * The acting user's effective access. The security context decides:
     * whoever holds one of the configured bypass roles (administrators by
     * default) is never restricted.
     */
    public function effectiveAccessForCurrentUser(): EffectiveAccess
    {
        if ($this->hasBypassRole()) {
            return EffectiveAccess::unrestricted('Account holds an access-control bypass role');
        }

        return $this->effectiveAccessForUser($this->currentUserId());
    }

    public function effectiveAccessForUser(?UserId $userId): EffectiveAccess
    {
        $cacheKey = $userId?->value ?? '';
        if (isset($this->effectiveAccessCache[$cacheKey])) {
            return $this->effectiveAccessCache[$cacheKey];
        }

        return $this->effectiveAccessCache[$cacheKey] = $this->resolveEffectiveAccess($userId);
    }

    /**
     * Whether the content repository should refuse writes outside a user's
     * roles, or restrictions only shape the Studio's UI. On either setting the
     * roles mean the same thing - this only decides how hard the "no" is.
     */
    public function isEnforcedInContentRepository(): bool
    {
        return (bool)($this->settings['enforceContentRepository'] ?? true);
    }

    /**
     * Where a node sits: its ancestor chain (node first, root last) and the
     * site it belongs to - the two things page-tree and site rules are
     * evaluated against.
     *
     * A node that cannot be resolved yields an empty context, which every
     * caller reads as "these axes do not apply". That is the fail-open half
     * of this service: an unresolvable node is not one this feature has
     * anything to say about, and the content repository will fail the
     * operation on its own terms anyway.
     *
     * @return array{0: array<int, string>, 1: string} [idPath, siteNodeName]
     */
    public function nodeContext(ContentSubgraphInterface $subgraph, NodeAggregateId $nodeAggregateId, ?Node $node = null): array
    {
        // Keyed by workspace and dimension too: ancestry is a property of the
        // subgraph, not of the aggregate id alone.
        $cacheKey = $subgraph->getWorkspaceName()->value . '|' . $subgraph->getDimensionSpacePoint()->hash . '|' . $nodeAggregateId->value;
        if (isset($this->nodeContextCache[$cacheKey])) {
            return $this->nodeContextCache[$cacheKey];
        }

        [$idPath, $siteNodeName] = $this->resolveNodeContext($subgraph, $nodeAggregateId, $node);

        // One walk answers for the whole chain, not just its head: the context
        // of each ancestor is a suffix of this one, with the same site. Filling
        // those in costs nothing and pays off in exactly the listings that hurt
        // - a flat descendants listing contains a node's ancestors as rows of
        // its own, and each of them is now free.
        $prefix = $subgraph->getWorkspaceName()->value . '|' . $subgraph->getDimensionSpacePoint()->hash . '|';
        foreach (array_values($idPath) as $index => $ancestorId) {
            $this->nodeContextCache[$prefix . $ancestorId] ??= [array_slice($idPath, $index), $siteNodeName];
        }

        return $this->nodeContextCache[$cacheKey];
    }

    /**
     * @return array{0: array<int, string>, 1: string}
     */
    private function resolveNodeContext(ContentSubgraphInterface $subgraph, NodeAggregateId $nodeAggregateId, ?Node $node): array
    {
        try {
            $idPath = [$nodeAggregateId->value];
            $siteNodeName = '';
            // Ordered closest-ancestor-first, so appending keeps the "index is
            // distance from the node" property allowsNodePath() relies on.
            $ancestors = $subgraph->findAncestorNodes($nodeAggregateId, FindAncestorNodesFilter::create());
            // Only needed to name the site when the node IS the site node.
            // Callers listing nodes already hold them - that halves the
            // queries this costs, from two per node to one.
            $previous = $node ?? $subgraph->findNodeById($nodeAggregateId);
            foreach ($ancestors as $ancestor) {
                /** @var Node $ancestor */
                if ($ancestor->classification === NodeAggregateClassification::CLASSIFICATION_ROOT) {
                    // The child of the sites root IS the site node - and the
                    // node itself when it has no non-root ancestor at all.
                    $siteNodeName = $previous?->name?->value ?? '';
                    break;
                }
                $idPath[] = $ancestor->aggregateId->value;
                $previous = $ancestor;
            }
        } catch (\Throwable) {
            return [[], ''];
        }

        return [$idPath, $siteNodeName];
    }

    /**
     * The nodes that must stay visible even though the roles do not grant
     * them: every ancestor of every branch a role DOES grant.
     *
     * Without this the page tree would strand its own content. A role that
     * grants "Products / Pumps" grants neither "Products" nor the site node,
     * yet hiding those leaves the editor with an empty tree and no way to
     * reach the one branch they may edit. So the ancestors stay - shown
     * read-only, as signposts.
     *
     * Resolved server-side on every read rather than stored with the rule:
     * ancestry changes whenever a page is moved, and a stale copy would hide
     * exactly the path an editor needs. The client caches the answer for a
     * few minutes, so this costs one traversal per allow rule per session.
     *
     * @return array<int, string> node aggregate ids, ancestors of allow rules
     */
    public function pathAnchorsFor(EffectiveAccess $access, ContentSubgraphInterface $subgraph): array
    {
        if ($access->unrestricted) {
            return [];
        }
        $cacheKey = $subgraph->getWorkspaceName()->value . '|' . $subgraph->getDimensionSpacePoint()->hash
            . '|' . implode(',', array_map(static fn (AccessRole $role) => $role->id, $access->roles));
        if (isset($this->pathAnchorCache[$cacheKey])) {
            return $this->pathAnchorCache[$cacheKey];
        }

        $anchors = [];
        foreach ($access->roles as $role) {
            foreach ($role->constraints->nodeTreeRules as $rule) {
                if (!$rule->isAllow()) {
                    continue;
                }
                try {
                    $ancestors = $subgraph->findAncestorNodes(
                        NodeAggregateId::fromString($rule->nodeAggregateId),
                        FindAncestorNodesFilter::create()
                    );
                } catch (\Throwable) {
                    // A rule pointing at a node that no longer resolves simply
                    // contributes no anchors.
                    continue;
                }
                foreach ($ancestors as $ancestor) {
                    /** @var Node $ancestor */
                    // The sites root is never rendered as a tree row.
                    if ($ancestor->classification === NodeAggregateClassification::CLASSIFICATION_ROOT) {
                        continue;
                    }
                    $anchors[$ancestor->aggregateId->value] = true;
                }
            }
        }

        return $this->pathAnchorCache[$cacheKey] = array_keys($anchors);
    }

    /**
     * @return array<int, string> the Flow roles that skip access control
     */
    public function bypassRoles(): array
    {
        $roles = $this->settings['bypassRoles'] ?? [];

        return is_array($roles) ? array_values(array_filter(array_map('strval', $roles))) : [];
    }

    private function resolveEffectiveAccess(?UserId $userId): EffectiveAccess
    {
        if ($userId === null) {
            // No Neos user behind the request: CLI, anonymous frontend, a
            // client-credentials token. Nothing to restrict against.
            return EffectiveAccess::unrestricted('No Neos user for this request');
        }

        try {
            $roles = $this->accessRoleRepository->findActiveByMember($userId);
        } catch (\Throwable) {
            // Tables not migrated yet, database unreachable - fail open.
            return EffectiveAccess::unrestricted('Access roles are unavailable');
        }

        if ($roles === []) {
            return ($this->settings['restrictUnassignedUsers'] ?? false)
                ? EffectiveAccess::restrictedBy([$this->denyAllRole()])
                : EffectiveAccess::unrestricted('No access role assigned');
        }

        return EffectiveAccess::restrictedBy($roles);
    }

    /**
     * The synthetic role that `restrictUnassignedUsers` gives to users
     * without an assignment: no site, hence nothing.
     */
    private function denyAllRole(): AccessRole
    {
        $now = new \DateTimeImmutable();

        return new AccessRole(
            '00000000-0000-0000-0000-000000000000',
            'unassigned',
            'Unassigned',
            'Synthetic role for users without an access role assignment.',
            AccessRoleConstraints::create(
                // Names no site and no workspace can have, so every lookup
                // against them misses and the role allows nothing.
                siteNodeNames: ['\0-none'],
                workspaceNames: ['\0-none'],
                allowPersonalWorkspace: false,
                allowPublishToLive: false,
                allowWorkspaceCreation: false,
                capabilities: array_fill_keys(AccessRoleConstraints::CAPABILITIES, false),
            ),
            true,
            $now,
            $now,
        );
    }

    private function currentUserId(): ?UserId
    {
        try {
            return $this->userService->getCurrentUser()?->getId();
        } catch (\Throwable) {
            return null;
        }
    }

    private function hasBypassRole(): bool
    {
        $bypassRoles = $this->bypassRoles();
        if ($bypassRoles === []) {
            return false;
        }
        try {
            if (!$this->securityContext->canBeInitialized()) {
                // Too early to tell (e.g. during compile time) - and too early
                // for anything to be authorized against, either.
                return true;
            }
            foreach ($this->securityContext->getRoles() as $role) {
                /** @var Role $role */
                if (in_array($role->getIdentifier(), $bypassRoles, true)) {
                    return true;
                }
            }
        } catch (\Throwable) {
            return true;
        }

        return false;
    }
}
