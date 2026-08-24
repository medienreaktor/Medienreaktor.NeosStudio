<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Domain\Model;

use Neos\Flow\Annotations as Flow;

/**
 * One page-tree rule of an {@see AccessRole}: "this document (and, by
 * default, everything below it) is allowed / denied".
 *
 * Rules are evaluated nearest-ancestor-first (see
 * {@see AccessRoleConstraints::allowsNodePath()}), which is what makes the
 * familiar "allow the branch, deny one page inside it" combination work
 * without an explicit priority field.
 *
 * `label` and `path` are denormalised copies taken when the rule was created
 * in the administration UI. They exist so a role can be listed and edited
 * without resolving every referenced node in some workspace/dimension the
 * administrator may not even be looking at - never for authorization
 * decisions, which use the aggregate id alone.
 */
#[Flow\Proxy(false)]
final readonly class NodeTreeRule implements \JsonSerializable
{
    public const MODE_ALLOW = 'ALLOW';
    public const MODE_DENY = 'DENY';

    private function __construct(
        /** self::MODE_ALLOW or self::MODE_DENY */
        public string $mode,
        /** The site the document belongs to - groups the rules in the UI. */
        public string $siteNodeName,
        public string $nodeAggregateId,
        public string $label,
        public string $path,
        /** false narrows the rule to exactly this one document. */
        public bool $includeDescendants,
    ) {
    }

    public static function create(
        string $mode,
        string $siteNodeName,
        string $nodeAggregateId,
        string $label = '',
        string $path = '',
        bool $includeDescendants = true,
    ): self {
        $mode = strtoupper(trim($mode));
        if ($mode !== self::MODE_ALLOW && $mode !== self::MODE_DENY) {
            throw new \InvalidArgumentException(sprintf('Node tree rule mode must be "ALLOW" or "DENY", got "%s".', $mode), 1756000001);
        }
        if (trim($nodeAggregateId) === '') {
            throw new \InvalidArgumentException('Node tree rule requires a node aggregate id.', 1756000002);
        }

        return new self($mode, trim($siteNodeName), trim($nodeAggregateId), $label, $path, $includeDescendants);
    }

    /**
     * @param array<string, mixed> $array
     */
    public static function fromArray(array $array): self
    {
        return self::create(
            is_string($array['mode'] ?? null) ? $array['mode'] : self::MODE_ALLOW,
            is_string($array['siteNodeName'] ?? null) ? $array['siteNodeName'] : '',
            is_string($array['nodeAggregateId'] ?? null) ? $array['nodeAggregateId'] : '',
            is_string($array['label'] ?? null) ? $array['label'] : '',
            is_string($array['path'] ?? null) ? $array['path'] : '',
            (bool)($array['includeDescendants'] ?? true),
        );
    }

    public function isAllow(): bool
    {
        return $this->mode === self::MODE_ALLOW;
    }

    /**
     * Does this rule speak about the given node? $distance is how far the
     * node is from the rule's anchor (0 = the anchor itself).
     */
    public function matches(string $nodeAggregateId, int $distance): bool
    {
        if ($nodeAggregateId !== $this->nodeAggregateId) {
            return false;
        }

        return $distance === 0 || $this->includeDescendants;
    }

    /**
     * @return array<string, mixed>
     */
    public function jsonSerialize(): array
    {
        return [
            'mode' => $this->mode,
            'siteNodeName' => $this->siteNodeName,
            'nodeAggregateId' => $this->nodeAggregateId,
            'label' => $this->label,
            'path' => $this->path,
            'includeDescendants' => $this->includeDescendants,
        ];
    }
}
