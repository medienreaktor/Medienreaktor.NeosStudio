<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Domain\Model;

use Neos\Flow\Annotations as Flow;

/**
 * What one {@see AccessRole} restricts: sites, page tree, dimensions,
 * workspaces and the coarse editing capabilities.
 *
 * The pervasive convention is **empty means unrestricted**. An empty site
 * list is "every site", an empty rule list is "the whole tree", an absent
 * dimension key is "every value of that dimension". A role therefore starts
 * out granting everything and is narrowed field by field - which is what
 * makes a freshly created role harmless and every restriction an explicit,
 * visible act.
 *
 * @see AccessRoleConstraints::allowsNodePath() for the page-tree semantics
 */
#[Flow\Proxy(false)]
final readonly class AccessRoleConstraints implements \JsonSerializable
{
    /**
     * The capability flags a role can withhold. Absent from the stored map =
     * granted, so adding a capability here never retroactively locks anyone
     * out of something they could do before the upgrade.
     *
     * Deliberately limited to what the content repository can actually be
     * held to (see the AccessControlAuthProvider's command mapping). A media
     * flag, for instance, would have to be enforced on the asset endpoints
     * rather than on CR commands - and a switch that only looks like it does
     * something is worse than no switch at all.
     */
    public const CAPABILITIES = [
        'editNodes',
        'createNodes',
        'deleteNodes',
        'moveNodes',
    ];

    /**
     * @param array<int, string> $siteNodeNames empty = every site
     * @param array<int, NodeTreeRule> $nodeTreeRules empty = the whole page tree
     * @param array<string, array<int, string>> $dimensionValues dimension id => allowed values; absent key = every value
     * @param array<int, string> $workspaceNames shared/root workspaces the role may use; empty = all of them
     * @param array<string, bool> $capabilities see self::CAPABILITIES; absent = granted
     */
    private function __construct(
        public array $siteNodeNames,
        public array $nodeTreeRules,
        public array $dimensionValues,
        public array $workspaceNames,
        /** The own personal workspace stays available unless this is false. */
        public bool $allowPersonalWorkspace,
        /** Publishing into a workspace's base - in practice "may go live". */
        public bool $allowPublishToLive,
        /** Create new shared workspaces (the workspace administration's "New"). */
        public bool $allowWorkspaceCreation,
        public array $capabilities,
    ) {
    }

    /** A role that restricts nothing - the starting point of every new role. */
    public static function unrestricted(): self
    {
        return new self([], [], [], [], true, true, true, []);
    }

    /**
     * @param array<int, string> $siteNodeNames
     * @param array<int, NodeTreeRule> $nodeTreeRules
     * @param array<string, array<int, string>> $dimensionValues
     * @param array<int, string> $workspaceNames
     * @param array<string, bool> $capabilities
     */
    public static function create(
        array $siteNodeNames = [],
        array $nodeTreeRules = [],
        array $dimensionValues = [],
        array $workspaceNames = [],
        bool $allowPersonalWorkspace = true,
        bool $allowPublishToLive = true,
        bool $allowWorkspaceCreation = true,
        array $capabilities = [],
    ): self {
        return new self(
            array_values(array_unique(array_filter(array_map('strval', $siteNodeNames)))),
            array_values($nodeTreeRules),
            self::normalizeDimensionValues($dimensionValues),
            array_values(array_unique(array_filter(array_map('strval', $workspaceNames)))),
            $allowPersonalWorkspace,
            $allowPublishToLive,
            $allowWorkspaceCreation,
            self::normalizeCapabilities($capabilities),
        );
    }

    /**
     * @param array<string, mixed> $array
     */
    public static function fromArray(array $array): self
    {
        $rules = [];
        foreach (is_array($array['nodeTreeRules'] ?? null) ? $array['nodeTreeRules'] : [] as $rule) {
            if (is_array($rule)) {
                $rules[] = NodeTreeRule::fromArray($rule);
            }
        }

        return self::create(
            is_array($array['siteNodeNames'] ?? null) ? $array['siteNodeNames'] : [],
            $rules,
            is_array($array['dimensionValues'] ?? null) ? $array['dimensionValues'] : [],
            is_array($array['workspaceNames'] ?? null) ? $array['workspaceNames'] : [],
            (bool)($array['allowPersonalWorkspace'] ?? true),
            (bool)($array['allowPublishToLive'] ?? true),
            (bool)($array['allowWorkspaceCreation'] ?? true),
            is_array($array['capabilities'] ?? null) ? $array['capabilities'] : [],
        );
    }

    public static function fromJsonString(string $json): self
    {
        $decoded = json_decode($json, true);

        return is_array($decoded) ? self::fromArray($decoded) : self::unrestricted();
    }

    public function allowsSite(string $siteNodeName): bool
    {
        return $this->siteNodeNames === [] || in_array($siteNodeName, $this->siteNodeNames, true);
    }

    /**
     * Does this ONE role permit the whole operation - every axis it touches at
     * once?
     *
     * This is the authoritative check, and the per-axis methods below exist
     * for shaping lists, not for deciding writes. The difference matters as
     * soon as an account holds two roles: asking "may I write?" and "in this
     * workspace?" separately and OR-ing each across all roles lets a role that
     * grants only the workspace combine with one that grants only the writing,
     * and the account ends up doing something neither role allows. Every axis
     * has to be satisfied by the SAME role.
     *
     * Null (or empty) arguments mean "not applicable to this operation" and
     * are skipped - creating a workspace has no node, a page-tree rule has
     * nothing to say about it.
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
        if ($siteNodeName !== '' && !$this->allowsSite($siteNodeName)) {
            return false;
        }
        if ($idPath !== [] && !$this->allowsNodePath($idPath)) {
            return false;
        }
        if ($dimensionCoordinates !== [] && !$this->allowsDimensionSpacePoint($dimensionCoordinates)) {
            return false;
        }
        if ($workspaceName !== null && !$this->allowsWorkspaceEditing($workspaceName, $workspaceClassification)) {
            return false;
        }
        if ($capability !== null && !$this->allowsCapability($capability)) {
            return false;
        }

        return true;
    }

    /**
     * @param array<string, string> $coordinates a dimension space point
     */
    public function allowsDimensionSpacePoint(array $coordinates): bool
    {
        foreach ($this->dimensionValues as $dimensionId => $allowedValues) {
            if ($allowedValues === []) {
                continue;
            }
            // A point that does not mention the restricted dimension at all
            // cannot violate the restriction - it is not in that space.
            if (!isset($coordinates[$dimensionId])) {
                continue;
            }
            if (!in_array($coordinates[$dimensionId], $allowedValues, true)) {
                return false;
            }
        }

        return true;
    }

    /**
     * May the account READ this workspace?
     *
     * Root workspaces - live above all - stay readable for everyone, and this
     * is not a courtesy: the frontend renders from live, so a role that cut
     * it off would take the website down for its own members rather than
     * merely narrowing their editing.
     *
     * @param string $classification ROOT, PERSONAL, SHARED or UNKNOWN
     */
    public function allowsWorkspaceRead(string $workspaceName, string $classification): bool
    {
        return match ($classification) {
            'PERSONAL' => $this->allowPersonalWorkspace,
            'SHARED' => $this->listAllows($workspaceName),
            default => true,
        };
    }

    /**
     * May the account WORK in this workspace - edit in it, target it as a
     * publish base, join it collaboratively?
     *
     * Unlike reading, live gets no exemption here. "Restricted to Entwurf"
     * has to mean the editor cannot also just switch back to live and work
     * there, or the restriction says nothing at all. Being able to *see* live
     * and being allowed to *change* it are separate questions, and this is
     * the second one.
     *
     * An empty list still means every workspace, live included - so a role
     * that does not mention workspaces changes nothing.
     *
     * @param string $classification ROOT, PERSONAL, SHARED or UNKNOWN
     */
    public function allowsWorkspaceEditing(string $workspaceName, string $classification): bool
    {
        return match ($classification) {
            'PERSONAL' => $this->allowPersonalWorkspace,
            // UNKNOWN covers workspaces created outside Neos' own service;
            // they carry no editorial meaning, so they follow the list too.
            default => $this->listAllows($workspaceName),
        };
    }

    private function listAllows(string $workspaceName): bool
    {
        return $this->workspaceNames === [] || in_array($workspaceName, $this->workspaceNames, true);
    }

    /** Unknown capability names are granted - see self::CAPABILITIES. */
    public function allowsCapability(string $capability): bool
    {
        return $this->capabilities[$capability] ?? true;
    }

    /**
     * Evaluate the page-tree rules against a node, given its ancestor chain.
     *
     * $idPath runs from the node itself outwards to the root, so the index of
     * an id IS its distance from the node - and the first rule that matches
     * while walking outwards is the nearest one, which wins. That single
     * property gives the combination everyone expects: allow a branch, deny a
     * page inside it, allow a page below that again.
     *
     * With no rule matching anywhere along the chain the answer depends on
     * whether the role uses allow rules at all: with allow rules present they
     * form a whitelist (everything not covered is denied), without them the
     * rules are a pure blacklist and the rest of the tree stays open.
     *
     * @param array<int, string> $idPath node aggregate id, then its ancestors' ids, root last
     */
    public function allowsNodePath(array $idPath): bool
    {
        if ($this->nodeTreeRules === []) {
            return true;
        }

        foreach (array_values($idPath) as $distance => $nodeAggregateId) {
            foreach ($this->nodeTreeRules as $rule) {
                if ($rule->matches($nodeAggregateId, $distance)) {
                    return $rule->isAllow();
                }
            }
        }

        return !$this->hasAllowRules();
    }

    public function hasAllowRules(): bool
    {
        foreach ($this->nodeTreeRules as $rule) {
            if ($rule->isAllow()) {
                return true;
            }
        }

        return false;
    }

    /** True if the role narrows anything at all - drives the "unrestricted" badge. */
    public function isRestricting(): bool
    {
        return $this->siteNodeNames !== []
            || $this->nodeTreeRules !== []
            || $this->dimensionValues !== []
            || $this->workspaceNames !== []
            || !$this->allowPersonalWorkspace
            || !$this->allowPublishToLive
            || !$this->allowWorkspaceCreation
            || in_array(false, $this->capabilities, true);
    }

    /**
     * @return array<string, mixed>
     */
    public function jsonSerialize(): array
    {
        return [
            'siteNodeNames' => $this->siteNodeNames,
            'nodeTreeRules' => array_map(static fn (NodeTreeRule $rule) => $rule->jsonSerialize(), $this->nodeTreeRules),
            'dimensionValues' => (object)$this->dimensionValues,
            'workspaceNames' => $this->workspaceNames,
            'allowPersonalWorkspace' => $this->allowPersonalWorkspace,
            'allowPublishToLive' => $this->allowPublishToLive,
            'allowWorkspaceCreation' => $this->allowWorkspaceCreation,
            'capabilities' => (object)$this->capabilities,
        ];
    }

    public function toJsonString(): string
    {
        return json_encode($this->jsonSerialize(), JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    /**
     * @param array<string, mixed> $dimensionValues
     * @return array<string, array<int, string>>
     */
    private static function normalizeDimensionValues(array $dimensionValues): array
    {
        $normalized = [];
        foreach ($dimensionValues as $dimensionId => $values) {
            if (!is_string($dimensionId) || !is_array($values)) {
                continue;
            }
            $values = array_values(array_unique(array_filter(array_map('strval', $values))));
            // An empty list is the same as no restriction; storing it would
            // only make the role look narrower than it is.
            if ($values !== []) {
                $normalized[$dimensionId] = $values;
            }
        }

        return $normalized;
    }

    /**
     * @param array<string, mixed> $capabilities
     * @return array<string, bool>
     */
    private static function normalizeCapabilities(array $capabilities): array
    {
        $normalized = [];
        foreach (self::CAPABILITIES as $capability) {
            if (array_key_exists($capability, $capabilities) && $capabilities[$capability] === false) {
                $normalized[$capability] = false;
            }
        }

        return $normalized;
    }
}
