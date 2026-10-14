<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

use Neos\ContentRepository\Core\ContentRepository;
use Neos\ContentRepository\Core\DimensionSpace\DimensionSpacePoint;
use Neos\ContentRepository\Core\NodeType\NodeTypeName;
use Neos\ContentRepository\Core\Projection\ContentGraph\ContentGraphInterface;
use Neos\ContentRepository\Core\Projection\ContentGraph\ContentSubgraphInterface;
use Neos\ContentRepository\Core\Projection\ContentGraph\Filter\FindClosestNodeFilter;
use Neos\ContentRepository\Core\Projection\ContentGraph\Node;
use Neos\ContentRepository\Core\Projection\ContentGraph\VisibilityConstraints;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAggregateId;
use Neos\ContentRepository\Core\SharedModel\Workspace\Workspace;
use Neos\Neos\Domain\SubtreeTagging\NeosSubtreeTag;
use Neos\Neos\PendingChangesProjection\Change;

/**
 * Per-request read context for one workspace: caches every repeated lookup the
 * workspace resources fan out over their changes/events - subgraphs per
 * dimension (workspace and base side), node resolution with base fallback,
 * closest-document/site ancestors, and node-type UI configuration. The change
 * listings issue these lookups once per pending change/event; without the
 * caches a workspace with hundreds of changes pays hundreds of identical
 * graph queries per request.
 *
 * Deliberately a plain object created per action (not an injected singleton):
 * all cached state is scoped to one workspace and one request.
 */
final class WorkspaceReadContext
{
    /** @var array<string, ContentSubgraphInterface> */
    private array $subgraphs = [];

    /** @var array<string, ContentSubgraphInterface> */
    private array $baseSubgraphs = [];

    /** Resolved nodes (workspace, base fallback): "id|dimHash" => [?Node, ?subgraph] */
    /** @var array<string, array{?Node, ?ContentSubgraphInterface}> */
    private array $resolvedNodes = [];

    /** Closest ancestors: "side|nodeTypes|id|dimHash" => ?Node */
    /** @var array<string, ?Node> */
    private array $closestNodes = [];

    /** Full node-type configuration (an expensive deep merge) per type name. */
    /** @var array<string, array<string, mixed>|null> */
    private array $nodeTypeConfigurations = [];

    /** The account's visibility constraints with soft removals made visible. */
    private ?VisibilityConstraints $visibilityConstraints = null;

    private ?ContentGraphInterface $contentGraph = null;

    private ?ContentGraphInterface $baseContentGraph = null;

    public function __construct(
        public readonly ContentRepository $contentRepository,
        public readonly Workspace $workspace,
        private readonly NodeLabelRenderer $labelRenderer,
    ) {
    }

    /**
     * The workspace's content graph - dimension-independent lookups (node
     * aggregates, their parents, their subtree tags). Cached: every call
     * re-checks the account's read permission on the workspace, which a loop
     * over changes or trash entries would pay per item.
     */
    public function contentGraph(): ContentGraphInterface
    {
        return $this->contentGraph ??= $this->contentRepository->getContentGraph($this->workspace->workspaceName);
    }

    public function subgraph(DimensionSpacePoint $dimensionSpacePoint): ContentSubgraphInterface
    {
        return $this->subgraphs[$dimensionSpacePoint->hash] ??= $this->contentGraph()
            ->getSubgraph($dimensionSpacePoint, $this->visibilityConstraints($dimensionSpacePoint));
    }

    /**
     * The base workspace's content graph - dimension-independent lookups in
     * what this workspace publishes to, e.g. "does this node aggregate exist
     * there at all". null for a root workspace (nothing underneath it).
     * Cached like the own graph, for the same reason.
     */
    public function baseContentGraph(): ?ContentGraphInterface
    {
        if ($this->workspace->baseWorkspaceName === null) {
            return null;
        }

        return $this->baseContentGraph ??= $this->contentRepository
            ->getContentGraph($this->workspace->baseWorkspaceName);
    }

    /** The base workspace's subgraph, or null for a root workspace. */
    public function baseSubgraph(DimensionSpacePoint $dimensionSpacePoint): ?ContentSubgraphInterface
    {
        $baseContentGraph = $this->baseContentGraph();
        if ($baseContentGraph === null) {
            return null;
        }

        return $this->baseSubgraphs[$dimensionSpacePoint->hash] ??= $baseContentGraph
            ->getSubgraph($dimensionSpacePoint, $this->visibilityConstraints($dimensionSpacePoint));
    }

    /**
     * Deleting is a SOFT removal in Neos: the node keeps existing, tagged
     * "removed", until publishing lets the garbage collector turn it into a
     * hard removal in live. Those nodes are excluded from the default backend
     * constraints - which is right everywhere except here: a change listing
     * that cannot resolve the node it reports has nothing to show but a raw
     * id, and it would attribute the change to a different document than the
     * content repository does when publishing it (which resolves soft removals
     * too, see WorkspacePublishingService::isChangePublishableWithinAncestorScope).
     * So the change resources drop the "removed" tag from the account's own
     * constraints and keep everything else - node-type read privileges stay
     * enforced, unlike with VisibilityConstraints::createEmpty().
     */
    private function visibilityConstraints(DimensionSpacePoint $dimensionSpacePoint): VisibilityConstraints
    {
        return $this->visibilityConstraints ??= VisibilityConstraints::excludeSubtreeTags(
            $this->contentRepository
                ->getContentSubgraph($this->workspace->workspaceName, $dimensionSpacePoint)
                ->getVisibilityConstraints()
                ->excludedSubtreeTags
                ->without(NeosSubtreeTag::removed())
        );
    }

    /**
     * A node by id in the workspace's subgraph, falling back to the base
     * workspace for nodes removed in the workspace (so a deletion still shows
     * what it deleted). Returns the node plus the subgraph it resolved in.
     *
     * @param array<string, string>|null $coordinates
     * @return array{?Node, ?ContentSubgraphInterface}
     */
    public function resolveNode(?string $nodeId, ?array $coordinates): array
    {
        if (!is_string($nodeId) || !is_array($coordinates)) {
            return [null, null];
        }
        $dimensionSpacePoint = DimensionSpacePoint::fromArray($coordinates);
        $cacheKey = $nodeId . '|' . $dimensionSpacePoint->hash;
        if (array_key_exists($cacheKey, $this->resolvedNodes)) {
            return $this->resolvedNodes[$cacheKey];
        }

        $aggregateId = NodeAggregateId::fromString($nodeId);
        $subgraph = $this->subgraph($dimensionSpacePoint);
        $node = $subgraph->findNodeById($aggregateId);
        if ($node !== null) {
            return $this->resolvedNodes[$cacheKey] = [$node, $subgraph];
        }
        $baseSubgraph = $this->baseSubgraph($dimensionSpacePoint);
        if ($baseSubgraph !== null) {
            $node = $baseSubgraph->findNodeById($aggregateId);
            if ($node !== null) {
                return $this->resolvedNodes[$cacheKey] = [$node, $baseSubgraph];
            }
        }

        return $this->resolvedNodes[$cacheKey] = [null, null];
    }

    /**
     * The closest ancestor (or self) of the given node types, in the workspace
     * or the base side. Cached: change listings ask this once per pending
     * change, and most changes share the same few documents.
     */
    public function closestNode(NodeAggregateId $nodeId, DimensionSpacePoint $dimensionSpacePoint, string $nodeTypes, bool $inBase = false): ?Node
    {
        $subgraph = $inBase ? $this->baseSubgraph($dimensionSpacePoint) : $this->subgraph($dimensionSpacePoint);
        if ($subgraph === null) {
            return null;
        }
        $cacheKey = ($inBase ? 'base' : 'ws') . '|' . $nodeTypes . '|' . $nodeId->value . '|' . $dimensionSpacePoint->hash;
        if (!array_key_exists($cacheKey, $this->closestNodes)) {
            $this->closestNodes[$cacheKey] = $subgraph->findClosestNode(
                $nodeId,
                FindClosestNodeFilter::create(nodeTypes: $nodeTypes)
            );
        }

        return $this->closestNodes[$cacheKey];
    }

    /**
     * The containing document and site of a node, resolved in the workspace
     * with a base-workspace fallback - the shared resolution of the changes,
     * document-changes and review resources. Soft removals resolve in the
     * workspace like anything else (see visibilityConstraints()); the fallback
     * is for HARD removals, where the node is gone from the workspace but still
     * exists in the base - resolving there keeps such a deletion attributed to
     * a document and site instead of dropping it (a base-resolved document is
     * display-only, not navigable - hence the inWorkspace flag).
     *
     * @return array{document: ?Node, site: ?Node, inWorkspace: bool}
     */
    public function closestDocumentAndSite(NodeAggregateId $nodeId, DimensionSpacePoint $dimensionSpacePoint): array
    {
        $document = $this->closestNode($nodeId, $dimensionSpacePoint, 'Neos.Neos:Document');
        $site = $this->closestNode($nodeId, $dimensionSpacePoint, 'Neos.Neos:Site');
        $inWorkspace = $document !== null;
        if ($document === null) {
            $document = $this->closestNode($nodeId, $dimensionSpacePoint, 'Neos.Neos:Document', inBase: true);
            $site ??= $this->closestNode($nodeId, $dimensionSpacePoint, 'Neos.Neos:Site', inBase: true);
        }

        return ['document' => $document, 'site' => $site, 'inWorkspace' => $inWorkspace];
    }

    /**
     * The document and site a PENDING CHANGE belongs to - the bucket every
     * change resource groups by, and the one publish/discard scoped to a
     * document acts on.
     *
     * Resolved from the same anchor the content repository uses when it scopes
     * a publish (see WorkspacePublishingService::isChangePublishableWithinAncestorScope):
     * the legacy removal attachment point when the change carries one,
     * the changed node otherwise. Only hard removals (RemoveNodeAggregate)
     * carry an attachment point, and it names a SURVIVING ancestor precisely
     * because the removed node itself is gone - so a hard removal is attributed
     * to the document that outlived it. Anything else, soft removals included,
     * resolves through the node itself. Grouping by anything else would list
     * changes under a document that publishing them does not accept.
     *
     * @return array{document: ?Node, site: ?Node, inWorkspace: bool}
     */
    public function changeDocumentAndSite(Change $change, DimensionSpacePoint $dimensionSpacePoint): array
    {
        // Neos 9.2 keeps removed nodes in the graph (tagged "removed") and dropped
        // the removal attachment point; 9.1 still needs it for deleted nodes.
        $anchor = method_exists($change, 'getLegacyRemovalAttachmentPoint')
            ? ($change->getLegacyRemovalAttachmentPoint() ?? $change->nodeAggregateId)
            : $change->nodeAggregateId;

        return $this->closestDocumentAndSite($anchor, $dimensionSpacePoint);
    }

    /** Whether the node is soft removed (deleted, pending publication). */
    public function isSoftRemoved(Node $node): bool
    {
        return $node->tags->contain(NeosSubtreeTag::removed());
    }

    /** The canonical plain-text node label (see NodeLabelRenderer::label()). */
    public function label(Node $node): string
    {
        return $this->labelRenderer->label($node);
    }

    /**
     * Document labels from the site down to (and including) the node.
     *
     * @return array<int, string>
     */
    public function breadcrumb(Node $node, ContentSubgraphInterface $subgraph): array
    {
        return $this->labelRenderer->breadcrumb($node, $subgraph);
    }

    /**
     * Node ids as {id, label} pairs a human can read, resolved in the
     * workspace (falling back to the base) in the given dimension.
     *
     * @param list<string> $nodeIds
     * @param array<string, string>|null $coordinates
     * @return list<array{id: string, label: ?string}>
     */
    public function describeNodes(array $nodeIds, ?array $coordinates): array
    {
        $described = [];
        foreach ($nodeIds as $nodeId) {
            [$node] = $this->resolveNode($nodeId, $coordinates);
            $described[] = [
                'id' => $nodeId,
                'label' => $node !== null ? $this->label($node) : null,
            ];
        }

        return $described;
    }

    /**
     * The node type's full configuration - a deep merge expensive enough to
     * remember per type name; label and icon lookups hit it per property row
     * and per document.
     *
     * @return array<string, mixed>|null
     */
    public function nodeTypeConfiguration(NodeTypeName $nodeTypeName): ?array
    {
        if (!array_key_exists($nodeTypeName->value, $this->nodeTypeConfigurations)) {
            $this->nodeTypeConfigurations[$nodeTypeName->value] = $this->contentRepository
                ->getNodeTypeManager()->getNodeType($nodeTypeName)?->getFullConfiguration();
        }

        return $this->nodeTypeConfigurations[$nodeTypeName->value];
    }

    /** The node type's configured UI icon. */
    public function icon(NodeTypeName $nodeTypeName): ?string
    {
        return $this->nodeTypeConfiguration($nodeTypeName)['ui']['icon'] ?? null;
    }

    /** Whether the node type is (a subtype of) the given one; false if unknown. */
    public function isOfType(NodeTypeName $nodeTypeName, string $superTypeName): bool
    {
        return $this->contentRepository->getNodeTypeManager()
            ->getNodeType($nodeTypeName)?->isOfType($superTypeName) ?? false;
    }

    /**
     * The configured human label of a property or reference from the node's
     * type - possibly an XLIFF shorthand the client translates, like every
     * node-type label the API emits.
     */
    public function propertyLabel(?Node $node, string $name, string $section): ?string
    {
        if ($node === null) {
            return null;
        }
        $label = $this->nodeTypeConfiguration($node->nodeTypeName)[$section][$name]['ui']['label'] ?? null;

        return is_string($label) ? $label : null;
    }
}
