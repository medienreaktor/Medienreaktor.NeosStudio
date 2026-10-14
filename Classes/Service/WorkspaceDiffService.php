<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

use Neos\ContentRepository\Core\DimensionSpace\DimensionSpacePoint;
use Neos\ContentRepository\Core\Projection\ContentGraph\ContentSubgraphInterface;
use Neos\ContentRepository\Core\Projection\ContentGraph\Filter\FindReferencesFilter;
use Neos\ContentRepository\Core\Projection\ContentGraph\Node;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAggregateId;
use Neos\EventStore\Model\EventEnvelope;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\SubtreeTagging\NeosSubtreeTag;

/**
 * Computes before/after change rows for the workspace review surfaces, in one
 * shared vocabulary ('property', 'reference', 'nodeType', 'name', 'parent',
 * 'position', 'tag', 'variant') so clients render both the same way:
 *
 *  - diffEventChanges(): what one pending EVENT changed - "old" is the value
 *    just before the event, resolved through the stream's own earlier writes
 *    (the EventBeforeWindow), falling back to the base workspace's value.
 *  - diffNodeAgainstBase(): the net STATE difference of one node variant
 *    between the workspace and its base - what publishing would apply.
 */
#[Flow\Scope('singleton')]
class WorkspaceDiffService
{
    /**
     * What one pending event changed, as before/after rows.
     *
     * @param array<string, mixed> $payload the envelope's decoded event payload
     * @return list<array<string, mixed>>
     */
    public function diffEventChanges(
        EventEnvelope $envelope,
        array $payload,
        ?Node $node,
        WorkspaceReadContext $context,
        EventBeforeWindow $beforeWindow
    ): array {
        $type = $envelope->event->type->value;
        $nodeId = $payload['nodeAggregateId'] ?? null;
        if (!is_string($nodeId)) {
            return [];
        }

        switch ($type) {
            case 'NodePropertiesWereSet': {
                $origin = is_array($payload['originDimensionSpacePoint'] ?? null) ? $payload['originDimensionSpacePoint'] : null;
                $rows = [];
                foreach ((array)($payload['propertyValues'] ?? []) as $name => $descriptor) {
                    $rows[] = [
                        'kind' => 'property',
                        'property' => (string)$name,
                        'label' => $context->propertyLabel($node, (string)$name, 'properties'),
                        'old' => $this->propertyValueBefore($nodeId, $origin, (string)$name, $beforeWindow, $context),
                        'new' => is_array($descriptor) && array_key_exists('value', $descriptor) ? $descriptor['value'] : null,
                    ];
                }
                foreach ((array)($payload['propertiesToUnset'] ?? []) as $name) {
                    $rows[] = [
                        'kind' => 'property',
                        'property' => (string)$name,
                        'label' => $context->propertyLabel($node, (string)$name, 'properties'),
                        'old' => $this->propertyValueBefore($nodeId, $origin, (string)$name, $beforeWindow, $context),
                        'new' => null,
                    ];
                }
                return $rows;
            }
            case 'NodeAggregateWithNodeWasCreated': {
                $rows = [];
                foreach ((array)($payload['initialPropertyValues'] ?? []) as $name => $descriptor) {
                    $rows[] = [
                        'kind' => 'property',
                        'property' => (string)$name,
                        'label' => $context->propertyLabel($node, (string)$name, 'properties'),
                        'old' => null,
                        'new' => is_array($descriptor) && array_key_exists('value', $descriptor) ? $descriptor['value'] : null,
                    ];
                }
                return $rows;
            }
            case 'NodeReferencesWereSet': {
                $origin = is_array($payload['affectedSourceOriginDimensionSpacePoints'][0] ?? null)
                    ? $payload['affectedSourceOriginDimensionSpacePoints'][0]
                    : null;
                $rows = [];
                foreach ((array)($payload['references'] ?? []) as $referencesForName) {
                    $referenceName = $referencesForName['referenceName'] ?? null;
                    if (!is_string($referenceName)) {
                        continue;
                    }
                    $newTargets = [];
                    foreach ((array)($referencesForName['references'] ?? []) as $reference) {
                        if (is_string($reference['target'] ?? null)) {
                            $newTargets[] = $reference['target'];
                        }
                    }
                    $oldTargets = $this->referenceTargetsBefore($nodeId, $origin, $referenceName, $beforeWindow, $context);
                    $rows[] = [
                        'kind' => 'reference',
                        'property' => $referenceName,
                        'label' => $context->propertyLabel($node, $referenceName, 'references'),
                        'old' => $context->describeNodes($oldTargets, $origin),
                        'new' => $context->describeNodes($newTargets, $origin),
                    ];
                }
                return $rows;
            }
            case 'NodeAggregateTypeWasChanged':
                return [[
                    'kind' => 'nodeType',
                    'property' => null,
                    'label' => null,
                    'old' => $this->nodeTypeBefore($nodeId, $beforeWindow, $context),
                    'new' => $payload['newNodeTypeName'] ?? null,
                ]];
            case 'NodeAggregateNameWasChanged':
                return [[
                    'kind' => 'name',
                    'property' => null,
                    'label' => null,
                    'old' => $this->nodeNameBefore($nodeId, $beforeWindow, $context),
                    'new' => $payload['newNodeName'] ?? null,
                ]];
            case 'NodeAggregateWasMoved': {
                $newParentId = $payload['newParentNodeAggregateId'] ?? null;
                if (!is_string($newParentId)) {
                    // Reorder among its siblings - same parent, new position.
                    return [['kind' => 'position', 'property' => null, 'label' => null, 'old' => null, 'new' => null]];
                }
                $coordinates = is_array($payload['succeedingSiblingsForCoverage'][0]['dimensionSpacePoint'] ?? null)
                    ? $payload['succeedingSiblingsForCoverage'][0]['dimensionSpacePoint']
                    : null;
                $oldParentId = $this->parentBefore($nodeId, $coordinates, $beforeWindow, $context);
                return [[
                    'kind' => 'parent',
                    'property' => null,
                    'label' => null,
                    'old' => $oldParentId !== null
                        ? ($context->describeNodes([$oldParentId], $coordinates)[0] ?? null)
                        : null,
                    'new' => $context->describeNodes([$newParentId], $coordinates)[0] ?? null,
                ]];
            }
            case 'SubtreeWasTagged':
            case 'SubtreeWasUntagged': {
                $tag = is_string($payload['tag'] ?? null) ? $payload['tag'] : null;
                return [[
                    'kind' => 'tag',
                    'property' => $tag,
                    'label' => null,
                    'old' => $type === 'SubtreeWasUntagged' ? $tag : null,
                    'new' => $type === 'SubtreeWasTagged' ? $tag : null,
                ]];
            }
            case 'NodeSpecializationVariantWasCreated':
            case 'NodeGeneralizationVariantWasCreated':
            case 'NodePeerVariantWasCreated':
                return [[
                    'kind' => 'variant',
                    'property' => null,
                    'label' => null,
                    'old' => $payload['sourceOrigin'] ?? null,
                    'new' => $payload['specializationOrigin'] ?? $payload['generalizationOrigin'] ?? $payload['peerOrigin'] ?? null,
                ]];
            default:
                return [];
        }
    }

    /**
     * The visible state differences of one node variant between the workspace
     * and its base: properties, node type, name, parent (or sibling position
     * for in-place moves), the disabled tag, and reference targets. A node
     * missing on one side diffs against nothing: created nodes list their
     * properties as new values, removed nodes need no rows (the status says
     * it all).
     *
     * @return list<array<string, mixed>>
     */
    public function diffNodeAgainstBase(
        ?Node $wsNode,
        ?Node $baseNode,
        bool $moved,
        ContentSubgraphInterface $subgraph,
        ?ContentSubgraphInterface $baseSubgraph,
        WorkspaceReadContext $context
    ): array {
        if ($wsNode === null) {
            return [];
        }
        $coordinates = $wsNode->originDimensionSpacePoint->coordinates;
        $rows = [];

        // Properties: the union of both sides, rows only where values differ.
        $wsProperties = [];
        foreach ($wsNode->properties->serialized() as $name => $serialized) {
            $wsProperties[$name] = $serialized->value;
        }
        $baseProperties = [];
        if ($baseNode !== null) {
            foreach ($baseNode->properties->serialized() as $name => $serialized) {
                $baseProperties[$name] = $serialized->value;
            }
        }
        foreach (array_keys($wsProperties + $baseProperties) as $name) {
            $old = $baseProperties[$name] ?? null;
            $new = $wsProperties[$name] ?? null;
            // Strict comparison: decoded JSON trees are === exactly when their
            // serialized forms match (key order and scalar types included).
            if ($old === $new) {
                continue;
            }
            $rows[] = [
                'kind' => 'property',
                'property' => (string)$name,
                'label' => $context->propertyLabel($wsNode, (string)$name, 'properties'),
                'old' => $old,
                'new' => $new,
            ];
        }

        if ($baseNode !== null && !$wsNode->nodeTypeName->equals($baseNode->nodeTypeName)) {
            $rows[] = [
                'kind' => 'nodeType',
                'property' => null,
                'label' => null,
                'old' => $baseNode->nodeTypeName->value,
                'new' => $wsNode->nodeTypeName->value,
            ];
        }
        if ($baseNode !== null && $wsNode->name?->value !== $baseNode->name?->value) {
            $rows[] = [
                'kind' => 'name',
                'property' => null,
                'label' => null,
                'old' => $baseNode->name?->value,
                'new' => $wsNode->name?->value,
            ];
        }

        // Parent: a real reparenting diffs; a move within the same parent is
        // a position change state cannot express better than "reordered".
        if ($baseNode !== null) {
            $wsParentId = $subgraph->findParentNode($wsNode->aggregateId)?->aggregateId->value;
            $baseParentId = $baseSubgraph?->findParentNode($baseNode->aggregateId)?->aggregateId->value;
            if ($wsParentId !== null && $baseParentId !== null && $wsParentId !== $baseParentId) {
                $rows[] = [
                    'kind' => 'parent',
                    'property' => null,
                    'label' => null,
                    'old' => $context->describeNodes([$baseParentId], $coordinates)[0] ?? null,
                    'new' => $context->describeNodes([$wsParentId], $coordinates)[0] ?? null,
                ];
            } elseif ($moved) {
                $rows[] = ['kind' => 'position', 'property' => null, 'label' => null, 'old' => null, 'new' => null];
            }
        }

        $wsDisabled = $wsNode->tags->contain(NeosSubtreeTag::disabled());
        $baseDisabled = $baseNode?->tags->contain(NeosSubtreeTag::disabled()) ?? false;
        if ($wsDisabled !== $baseDisabled) {
            $rows[] = [
                'kind' => 'tag',
                'property' => 'disabled',
                'label' => null,
                'old' => $baseDisabled ? 'disabled' : null,
                'new' => $wsDisabled ? 'disabled' : null,
            ];
        }

        // References: target id lists per reference name, both sides.
        $collectReferences = static function (?ContentSubgraphInterface $fromSubgraph, ?Node $node): array {
            if ($fromSubgraph === null || $node === null) {
                return [];
            }
            $byName = [];
            foreach ($fromSubgraph->findReferences($node->aggregateId, FindReferencesFilter::create()) as $reference) {
                $byName[$reference->name->value][] = $reference->node->aggregateId->value;
            }
            return $byName;
        };
        try {
            $wsReferences = $collectReferences($subgraph, $wsNode);
            $baseReferences = $collectReferences($baseSubgraph, $baseNode);
            foreach (array_keys($wsReferences + $baseReferences) as $referenceName) {
                $oldTargets = $baseReferences[$referenceName] ?? [];
                $newTargets = $wsReferences[$referenceName] ?? [];
                if ($oldTargets === $newTargets) {
                    continue;
                }
                $rows[] = [
                    'kind' => 'reference',
                    'property' => (string)$referenceName,
                    'label' => $context->propertyLabel($wsNode, (string)$referenceName, 'references'),
                    'old' => $context->describeNodes($oldTargets, $coordinates),
                    'new' => $context->describeNodes($newTargets, $coordinates),
                ];
            }
        } catch (\Throwable) {
            // Reference reads must never break the diff - properties and the
            // structural rows above still tell the story.
        }

        return $rows;
    }

    /**
     * The value a property had just before the diffed event: the newest
     * earlier write to it in the same stream (a set, an unset, the node's
     * creation, or - transitively - the variant source it was copied from),
     * falling back to the value the base workspace holds.
     *
     * @param array<string, string>|null $origin
     */
    private function propertyValueBefore(
        string $nodeId,
        ?array $origin,
        string $property,
        EventBeforeWindow $beforeWindow,
        WorkspaceReadContext $context
    ): mixed {
        foreach ($beforeWindow->eventsFor($nodeId) as ['type' => $type, 'payload' => $payload]) {
            switch ($type) {
                case 'NodePropertiesWereSet':
                    if (!$this->sameCoordinates($payload['originDimensionSpacePoint'] ?? null, $origin)) {
                        break;
                    }
                    $descriptor = $payload['propertyValues'][$property] ?? null;
                    if (is_array($descriptor) && array_key_exists('value', $descriptor)) {
                        return $descriptor['value'];
                    }
                    if (in_array($property, (array)($payload['propertiesToUnset'] ?? []), true)) {
                        return null;
                    }
                    break;
                case 'NodeAggregateWithNodeWasCreated':
                    if (!$this->sameCoordinates($payload['originDimensionSpacePoint'] ?? null, $origin)) {
                        break;
                    }
                    // The node was created inside this workspace: its initial
                    // value is definitive, the base cannot know it.
                    $descriptor = $payload['initialPropertyValues'][$property] ?? null;
                    return is_array($descriptor) && array_key_exists('value', $descriptor) ? $descriptor['value'] : null;
                case 'NodeSpecializationVariantWasCreated':
                case 'NodeGeneralizationVariantWasCreated':
                case 'NodePeerVariantWasCreated':
                    // The variant copied the source origin's values when it
                    // was created - continue the scan in the source origin.
                    $target = $payload['specializationOrigin'] ?? $payload['generalizationOrigin'] ?? $payload['peerOrigin'] ?? null;
                    if ($this->sameCoordinates($target, $origin) && is_array($payload['sourceOrigin'] ?? null)) {
                        $origin = $payload['sourceOrigin'];
                    }
                    break;
            }
        }

        if ($context->workspace->baseWorkspaceName === null || !is_array($origin)) {
            return null;
        }
        try {
            $subgraph = $context->baseSubgraph(DimensionSpacePoint::fromArray($origin));
            return $subgraph?->findNodeById(NodeAggregateId::fromString($nodeId))
                ?->properties->serialized()->getProperty($property)?->value;
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * The reference targets a name pointed to just before the diffed event.
     *
     * @param array<string, string>|null $origin
     * @return list<string>
     */
    private function referenceTargetsBefore(
        string $nodeId,
        ?array $origin,
        string $referenceName,
        EventBeforeWindow $beforeWindow,
        WorkspaceReadContext $context
    ): array {
        foreach ($beforeWindow->eventsFor($nodeId) as ['type' => $type, 'payload' => $payload]) {
            if ($type === 'NodeReferencesWereSet') {
                $affected = (array)($payload['affectedSourceOriginDimensionSpacePoints'] ?? []);
                $matches = $origin === null || array_filter($affected, fn ($point) => $this->sameCoordinates($point, $origin)) !== [];
                if (!$matches) {
                    continue;
                }
                foreach ((array)($payload['references'] ?? []) as $referencesForName) {
                    if (($referencesForName['referenceName'] ?? null) !== $referenceName) {
                        continue;
                    }
                    $targets = [];
                    foreach ((array)($referencesForName['references'] ?? []) as $reference) {
                        if (is_string($reference['target'] ?? null)) {
                            $targets[] = $reference['target'];
                        }
                    }
                    return $targets;
                }
            }
            if ($type === 'NodeAggregateWithNodeWasCreated' && $this->sameCoordinates($payload['originDimensionSpacePoint'] ?? null, $origin)) {
                foreach ((array)($payload['nodeReferences'] ?? []) as $referencesForName) {
                    if (($referencesForName['referenceName'] ?? null) !== $referenceName) {
                        continue;
                    }
                    $targets = [];
                    foreach ((array)($referencesForName['references'] ?? []) as $reference) {
                        if (is_string($reference['target'] ?? null)) {
                            $targets[] = $reference['target'];
                        }
                    }
                    return $targets;
                }
                return [];
            }
        }

        if ($context->workspace->baseWorkspaceName === null || !is_array($origin)) {
            return [];
        }
        try {
            $subgraph = $context->baseSubgraph(DimensionSpacePoint::fromArray($origin));
            if ($subgraph === null) {
                return [];
            }
            $targets = [];
            foreach ($subgraph->findReferences(NodeAggregateId::fromString($nodeId), FindReferencesFilter::create(referenceName: $referenceName)) as $reference) {
                $targets[] = $reference->node->aggregateId->value;
            }
            return $targets;
        } catch (\Throwable) {
            return [];
        }
    }

    /**
     * The node type an aggregate had before the diffed event: an earlier type
     * change or its creation in this stream, else what the base knows.
     */
    private function nodeTypeBefore(string $nodeId, EventBeforeWindow $beforeWindow, WorkspaceReadContext $context): ?string
    {
        foreach ($beforeWindow->eventsFor($nodeId) as ['type' => $type, 'payload' => $payload]) {
            if ($type === 'NodeAggregateTypeWasChanged' && is_string($payload['newNodeTypeName'] ?? null)) {
                return $payload['newNodeTypeName'];
            }
            if ($type === 'NodeAggregateWithNodeWasCreated' && is_string($payload['nodeTypeName'] ?? null)) {
                return $payload['nodeTypeName'];
            }
        }
        if ($context->workspace->baseWorkspaceName === null) {
            return null;
        }
        try {
            return $context->contentRepository->getContentGraph($context->workspace->baseWorkspaceName)
                ->findNodeAggregateById(NodeAggregateId::fromString($nodeId))?->nodeTypeName->value;
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * The node name an aggregate had before the diffed event.
     */
    private function nodeNameBefore(string $nodeId, EventBeforeWindow $beforeWindow, WorkspaceReadContext $context): ?string
    {
        foreach ($beforeWindow->eventsFor($nodeId) as ['type' => $type, 'payload' => $payload]) {
            if ($type === 'NodeAggregateNameWasChanged' && is_string($payload['newNodeName'] ?? null)) {
                return $payload['newNodeName'];
            }
            if ($type === 'NodeAggregateWithNodeWasCreated') {
                return is_string($payload['nodeName'] ?? null) ? $payload['nodeName'] : null;
            }
        }
        if ($context->workspace->baseWorkspaceName === null) {
            return null;
        }
        try {
            return $context->contentRepository->getContentGraph($context->workspace->baseWorkspaceName)
                ->findNodeAggregateById(NodeAggregateId::fromString($nodeId))?->nodeName?->value;
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * The parent an aggregate hung under before the diffed move: an earlier
     * move or its creation in this stream, else the base workspace's parent.
     *
     * @param array<string, string>|null $coordinates
     */
    private function parentBefore(
        string $nodeId,
        ?array $coordinates,
        EventBeforeWindow $beforeWindow,
        WorkspaceReadContext $context
    ): ?string {
        foreach ($beforeWindow->eventsFor($nodeId) as ['type' => $type, 'payload' => $payload]) {
            if ($type === 'NodeAggregateWasMoved' && is_string($payload['newParentNodeAggregateId'] ?? null)) {
                return $payload['newParentNodeAggregateId'];
            }
            if ($type === 'NodeAggregateWithNodeWasCreated' && is_string($payload['parentNodeAggregateId'] ?? null)) {
                return $payload['parentNodeAggregateId'];
            }
        }
        if ($context->workspace->baseWorkspaceName === null || !is_array($coordinates)) {
            return null;
        }
        try {
            $subgraph = $context->baseSubgraph(DimensionSpacePoint::fromArray($coordinates));
            return $subgraph?->findParentNode(NodeAggregateId::fromString($nodeId))?->aggregateId->value;
        } catch (\Throwable) {
            return null;
        }
    }

    /** Dimension coordinates compare as unordered maps; null only equals null. */
    private function sameCoordinates(mixed $a, mixed $b): bool
    {
        if (!is_array($a) || !is_array($b)) {
            return $a === null && $b === null;
        }
        ksort($a);
        ksort($b);
        return $a == $b;
    }
}
