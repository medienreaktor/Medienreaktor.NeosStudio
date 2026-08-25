<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Domain\Model;

use Neos\Flow\Annotations as Flow;

/**
 * What one user may reach right now: the {@see AccessRole}s assigned to them,
 * collapsed into the questions the Studio and the content repository ask.
 *
 * Roles are **additive**. Every question below is answered by OR-ing the
 * roles, so assigning a second role can only ever widen what someone may do -
 * never narrow it. That is why the union is computed per role rather than by
 * merging the constraint sets: merging two page-tree rule lists would let one
 * role's DENY rule silently cut into a branch the other role grants, which is
 * the opposite of additive.
 *
 * `unrestricted` short-circuits everything and covers the two cases that must
 * stay open by construction: administrators (and whoever else the
 * bypassRoles setting names), and users with no role assigned at all - so
 * installing this feature changes nothing until an administrator actually
 * assigns a role.
 */
#[Flow\Proxy(false)]
final readonly class EffectiveAccess
{
    /**
     * @param array<int, AccessRole> $roles
     */
    private function __construct(
        public bool $unrestricted,
        public array $roles,
        /** Why access is unrestricted - surfaced in the UI and in denial messages. */
        public string $reason,
    ) {
    }

    public static function unrestricted(string $reason): self
    {
        return new self(true, [], $reason);
    }

    /**
     * @param array<int, AccessRole> $roles must not be empty - an empty
     *        assignment is unrestricted, not restricted-to-nothing
     */
    public static function restrictedBy(array $roles): self
    {
        $roles = array_values($roles);
        if ($roles === []) {
            return self::unrestricted('No access role assigned');
        }

        return new self(false, $roles, sprintf('Restricted by %d access role(s)', count($roles)));
    }

    /**
     * The authoritative check: is there ONE role that permits this operation
     * on every axis at once?
     *
     * The per-axis methods below answer "could any role allow this at all",
     * which is what shaping a list needs - which sites to offer, which
     * workspaces to put in the switcher. Deciding a write with them would be
     * wrong: OR-ing each axis separately lets a role granting only the
     * workspace combine with one granting only the writing, and the account
     * does something neither role allows.
     *
     * @param array<int, string> $idPath node aggregate id first, ancestors outwards; [] = no node
     * @param array<string, string> $dimensionCoordinates [] = no dimension
     */
    public function permits(
        string $siteNodeName = '',
        array $idPath = [],
        array $dimensionCoordinates = [],
        ?string $workspaceName = null,
        string $workspaceClassification = 'UNKNOWN',
        ?string $capability = null,
    ): bool {
        return $this->anyRole(
            static fn (AccessRoleConstraints $c) => $c->permits(
                $siteNodeName,
                $idPath,
                $dimensionCoordinates,
                $workspaceName,
                $workspaceClassification,
                $capability,
            )
        );
    }

    public function allowsSite(string $siteNodeName): bool
    {
        return $this->anyRole(static fn (AccessRoleConstraints $c) => $c->allowsSite($siteNodeName));
    }

    /**
     * @param array<string, string> $coordinates
     */
    public function allowsDimensionSpacePoint(array $coordinates): bool
    {
        return $this->anyRole(static fn (AccessRoleConstraints $c) => $c->allowsDimensionSpacePoint($coordinates));
    }

    /**
     * @param string $classification ROOT, PERSONAL, SHARED or UNKNOWN
     */
    public function allowsWorkspaceRead(string $workspaceName, string $classification): bool
    {
        return $this->anyRole(static fn (AccessRoleConstraints $c) => $c->allowsWorkspaceRead($workspaceName, $classification));
    }

    /**
     * @param string $classification ROOT, PERSONAL, SHARED or UNKNOWN
     */
    public function allowsWorkspaceEditing(string $workspaceName, string $classification): bool
    {
        return $this->anyRole(static fn (AccessRoleConstraints $c) => $c->allowsWorkspaceEditing($workspaceName, $classification));
    }

    public function allowsPublishToLive(): bool
    {
        return $this->anyRole(static fn (AccessRoleConstraints $c) => $c->allowPublishToLive);
    }

    public function allowsWorkspaceCreation(): bool
    {
        return $this->anyRole(static fn (AccessRoleConstraints $c) => $c->allowWorkspaceCreation);
    }

    public function allowsCapability(string $capability): bool
    {
        return $this->anyRole(static fn (AccessRoleConstraints $c) => $c->allowsCapability($capability));
    }

    /**
     * The full node check: the site the node lives in AND its position in the
     * page tree, evaluated inside one role - a role that grants the branch
     * but not the site must not combine with another role the other way round.
     *
     * @param array<int, string> $idPath node aggregate id first, ancestors outwards
     */
    public function allowsNode(array $idPath, string $siteNodeName): bool
    {
        return $this->anyRole(
            static fn (AccessRoleConstraints $c) => ($siteNodeName === '' || $c->allowsSite($siteNodeName))
                && $c->allowsNodePath($idPath)
        );
    }

    /**
     * Whether any assigned role narrows by WHERE a node sits - its site or its
     * place in the page tree.
     *
     * The escape hatch for the read filter: resolving that position costs a
     * subgraph query per node, and a role that only restricts workspaces,
     * dimensions or capabilities has no use for it. Asking first turns those
     * roles from "one query per row" into free.
     */
    public function narrowsByNodePosition(): bool
    {
        if ($this->unrestricted) {
            return false;
        }
        foreach ($this->roles as $role) {
            if ($role->constraints->nodeTreeRules !== [] || $role->constraints->siteNodeNames !== []) {
                return true;
            }
        }

        return false;
    }

    /**
     * How a node should be treated in a listing - the server-side twin of the
     * client's nodeAccessState():
     *
     *  - 'allowed'    a role covers it
     *  - 'restricted' not covered, but on the way to something that is, so it
     *                 stays listed (read-only) - hiding it would strand the
     *                 granted branch below with no way to navigate to it
     *  - 'hidden'     neither; nothing an editor could do with it and nothing
     *                 below it they could reach
     *
     * @param array<int, string> $idPath node aggregate id first, ancestors outwards
     * @param array<int, string> $pathAnchors ancestors of every granted branch
     * @return string 'allowed', 'restricted' or 'hidden'
     */
    public function nodeVisibility(array $idPath, string $siteNodeName, array $pathAnchors): string
    {
        if ($this->unrestricted) {
            return 'allowed';
        }
        // A role that does not cover this site has no opinion about pages in it.
        $applicable = array_filter(
            $this->roles,
            static fn (AccessRole $role) => $siteNodeName === '' || $role->constraints->allowsSite($siteNodeName)
        );
        if ($applicable === []) {
            return 'hidden';
        }

        $verdicts = array_map(
            static fn (AccessRole $role) => $role->constraints->nodePathVerdict($idPath),
            array_values($applicable)
        );
        if (in_array('allow', $verdicts, true)) {
            return 'allowed';
        }

        // Not granted - so it only stays listed if something granted lives
        // below it.
        return in_array($idPath[0] ?? '', $pathAnchors, true) ? 'restricted' : 'hidden';
    }

    /**
     * The wire format for the Studio shell, which re-evaluates the same rules
     * client-side to shape its UI. Roles travel individually and complete,
     * because the OR-per-role semantics above cannot be expressed as one
     * merged constraint set.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'unrestricted' => $this->unrestricted,
            'reason' => $this->reason,
            'roles' => array_map(static fn (AccessRole $role) => [
                'id' => $role->id,
                'identifier' => $role->identifier,
                'label' => $role->label,
                'constraints' => $role->constraints->jsonSerialize(),
            ], $this->roles),
        ];
    }

    /**
     * @param \Closure(AccessRoleConstraints): bool $predicate
     */
    private function anyRole(\Closure $predicate): bool
    {
        if ($this->unrestricted) {
            return true;
        }
        foreach ($this->roles as $role) {
            if ($predicate($role->constraints)) {
                return true;
            }
        }

        return false;
    }
}
