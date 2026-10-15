<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

use Neos\ContentRepository\Core\DimensionSpace\DimensionSpacePointSet;
use Neos\ContentRepository\Core\DimensionSpace\OriginDimensionSpacePointSet;
use Neos\ContentRepository\Core\Projection\ContentGraph\ContentGraphInterface;
use Neos\ContentRepository\Core\Projection\ContentGraph\Node;
use Neos\ContentRepository\Core\Projection\ContentGraph\NodeAggregate;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAggregateId;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\Model\UserId;
use Neos\Neos\Domain\Service\UserService;
use Neos\Neos\Domain\SubtreeTagging\NeosSubtreeTag;
use Neos\Workspace\Ui\Domain\TrashBin\TrashBinPagination;
use Neos\Workspace\Ui\Domain\TrashBin\TrashBinSorting;
use Neos\Workspace\Ui\Domain\TrashBin\TrashItemFinder;

/**
 * A workspace's trash bin: the nodes deleted in it (restoring one is Neos.Api's
 * restoreNode, which untags the node and its deleted ancestors).
 *
 * Deleting is a soft removal - the node keeps existing, tagged "removed", and
 * is excluded from every read (see WorkspaceReadContext::visibilityConstraints()
 * for why the change resources widen that). Until the deletion is published and
 * the content repository's garbage collector turns it into a hard removal in
 * live, the node is fully intact and can be brought back by untagging it.
 *
 * Two sources of truth are joined here: the subtree TAG says what is deleted
 * (authoritative - the graph state), and Neos' trash bin projection says when
 * and by whom (metadata the graph does not keep). Rows of the projection whose
 * tag is gone are ignored, so a restored node - or one whose workspace was
 * deleted - never lingers as a phantom entry.
 *
 * Both the projection (TrashItemFinder) and NeosSubtreeTag are @internal in
 * Neos, the same dependency the change resources already take on ChangeFinder;
 * revisit when neos/neos-development-collection#5493 lands a public API.
 *
 * Each entry names the deleted ancestors a restore brings back along with it
 * (restoreNode untags them too - a node inside a deleted parent would stay
 * invisible otherwise).
 */
#[Flow\Scope('singleton')]
class WorkspaceTrashService
{
    /**
     * How many trash rows are enriched at most. Enrichment resolves nodes,
     * ancestors and users per row, so the resource stays bounded; the response
     * reports the truncation instead of silently shortening the list.
     */
    private const ITEM_LIMIT = 500;

    #[Flow\Inject]
    protected UserService $userService;

    /**
     * The workspace's trash entries, newest deletion first, enriched for
     * display: what was deleted (label, type, icon, breadcrumb, the dimensions
     * it was deleted in), when, by whom, and which additional ancestors a
     * restore would bring back with it.
     *
     * $documentsOnly drops deleted content elements before they are enriched,
     * for clients that restore pages only. It is a real filter, not a hint the
     * client could apply itself: the trash of a workspace also holds everything
     * its base ever deleted (publishing a deletion moves the entry to the base
     * and copies the base's entries back down), so content elements accumulate
     * without bound and would otherwise eat the enrichment budget below - and
     * push the deleted pages out of the response entirely.
     *
     * @return array{items: list<array<string, mixed>>, truncated: bool}
     */
    public function listItems(WorkspaceReadContext $context, bool $documentsOnly = false): array
    {
        $contentGraph = $context->contentGraph();
        $rows = $context->contentRepository->projectionState(TrashItemFinder::class)
            ->findItemsByWorkspaceNameWithParameters(
                $context->workspace->workspaceName,
                TrashBinSorting::default(),
                // One over the limit: reading it back tells the client the list
                // was cut without a second count query.
                TrashBinPagination::create(0, self::ITEM_LIMIT + 1),
                null
            );

        $items = [];
        $userLabels = [];
        $truncated = false;
        $scanned = 0;
        foreach ($rows as $row) {
            $scanned++;
            // Two ways to run out: more rows exist than were fetched (the row
            // past the limit is the sentinel), or the enrichment cap is full.
            // Skipped rows must not count towards either, or a filtered list
            // would report a truncation it did not suffer - and an unfiltered
            // one would report none while rows went unread.
            if ($scanned > self::ITEM_LIMIT || count($items) >= self::ITEM_LIMIT) {
                $truncated = true;
                break;
            }
            $nodeAggregate = $contentGraph->findNodeAggregateById($row->nodeAggregateId);
            if ($nodeAggregate === null) {
                // Hard removed meanwhile (published deletion, garbage collected).
                continue;
            }
            $isDocument = $context->isOfType($nodeAggregate->nodeTypeName, 'Neos.Neos:Document');
            if ($documentsOnly && !$isDocument) {
                continue;
            }
            $deletedIn = $this->deletedCoverage($nodeAggregate);
            if ($deletedIn->isEmpty()) {
                // The tag is gone: restored already, or a stale projection row.
                continue;
            }

            $variants = $this->deletedVariants($context, $nodeAggregate, $deletedIn);
            $node = $variants === [] ? null : $variants[0]['node'];
            $userId = $row->userId !== null && !$row->userId->isSystemUser() ? $row->userId->value : null;
            if ($userId !== null && !array_key_exists($userId, $userLabels)) {
                $userLabels[$userId] = $this->resolveUserLabel($userId);
            }

            $items[] = [
                'nodeAggregateId' => $row->nodeAggregateId->value,
                // Address of the deleted node in this workspace and the first
                // dimension it was deleted in. Only resolvable through a read
                // that opts into deleted nodes (Neos.Api includeRemoved) - which is
                // exactly what a client showing this entry does when it wants
                // to look at the page before restoring it.
                'nodeAddress' => $node !== null
                    ? NodeAddresses::toArray($node)
                    : null,
                'label' => $node !== null
                    ? $context->label($node)
                    : $nodeAggregate->nodeTypeName->value,
                'nodeType' => $nodeAggregate->nodeTypeName->value,
                'icon' => $context->icon($nodeAggregate->nodeTypeName),
                // Documents (pages) are the entries a page-level trash lists;
                // deleted content elements share the resource unless filtered out.
                'isDocument' => $isDocument,
                // Site node down to the deleted node itself, like the
                // document-changes resource - clients drop the last entry to
                // show only where it lived.
                'breadcrumb' => $variants === [] ? [] : $variants[0]['breadcrumb'],
                'siteAggregateId' => $variants === [] ? null : $variants[0]['siteAggregateId'],
                'siteLabel' => $variants === [] ? null : $variants[0]['siteLabel'],
                // Every dimension space point the node is deleted in, as
                // coordinates - clients label them from the content dimensions.
                'dimensions' => array_map(
                    static fn (array $variant): array => $variant['dimensions'],
                    $variants
                ),
                'deletedAt' => $row->deleteTime?->format(\DateTimeInterface::ATOM),
                'deletedBy' => $userId !== null ? $userLabels[$userId] : null,
                'restoresAncestors' => $this->deletedAncestors($context, $contentGraph, $row->nodeAggregateId),
            ];
        }

        return ['items' => $items, 'truncated' => $truncated];
    }

    /**
     * The dimension space points the node aggregate is deleted in ITSELF -
     * without the ones that merely inherit the tag from an ancestor, which
     * untagging the node would not bring back anyway.
     */
    private function deletedCoverage(?NodeAggregate $nodeAggregate): DimensionSpacePointSet
    {
        return $nodeAggregate?->getCoveredDimensionsTaggedBy(NeosSubtreeTag::removed(), true)
            ?? DimensionSpacePointSet::fromArray([]);
    }

    /**
     * One entry per deleted variant of the node: the node itself plus what it
     * takes to name it (breadcrumb, site, dimension coordinates). Resolved
     * through the read context, whose subgraphs see deleted nodes.
     *
     * @return list<array{node: Node, dimensions: array<string, string>, breadcrumb: array<int, string>, siteAggregateId: ?string, siteLabel: ?string}>
     */
    private function deletedVariants(
        WorkspaceReadContext $context,
        NodeAggregate $nodeAggregate,
        DimensionSpacePointSet $deletedIn
    ): array {
        $variants = [];
        $origins = $nodeAggregate->occupiedDimensionSpacePoints->getIntersection(
            OriginDimensionSpacePointSet::fromDimensionSpacePointSet($deletedIn)
        );
        foreach ($origins as $origin) {
            $node = $nodeAggregate->getNodeByOccupiedDimensionSpacePoint($origin);
            $dimensionSpacePoint = $origin->toDimensionSpacePoint();
            $subgraph = $context->subgraph($dimensionSpacePoint);
            $site = $context->closestDocumentAndSite($nodeAggregate->nodeAggregateId, $dimensionSpacePoint)['site'];
            $variants[] = [
                'node' => $node,
                'dimensions' => $dimensionSpacePoint->coordinates,
                'breadcrumb' => $context->breadcrumb($node, $subgraph),
                'siteAggregateId' => $site?->aggregateId->value,
                'siteLabel' => $site !== null ? $context->label($site) : null,
            ];
        }

        return $variants;
    }

    /** The aggregate's label from any of its deleted variants, or null. */
    private function aggregateLabel(
        WorkspaceReadContext $context,
        NodeAggregate $nodeAggregate,
        DimensionSpacePointSet $deletedIn
    ): ?string {
        $variants = $this->deletedVariants($context, $nodeAggregate, $deletedIn);

        return $variants === [] ? null : $context->label($variants[0]['node']);
    }

    /**
     * The deleted ancestors of a node, nearest first - restoring the node
     * restores these too, or it would stay hidden inside a deleted parent.
     *
     * @return list<array{nodeAggregateId: string, label: ?string}>
     */
    private function deletedAncestors(
        WorkspaceReadContext $context,
        ContentGraphInterface $contentGraph,
        NodeAggregateId $nodeAggregateId
    ): array {
        $ancestors = [];
        $seen = [$nodeAggregateId->value => true];
        $queue = [$nodeAggregateId];
        while ($queue !== []) {
            $current = array_shift($queue);
            foreach ($contentGraph->findParentNodeAggregates($current) as $parent) {
                if (isset($seen[$parent->nodeAggregateId->value])) {
                    continue;
                }
                $seen[$parent->nodeAggregateId->value] = true;
                $queue[] = $parent->nodeAggregateId;
                $deletedIn = $this->deletedCoverage($parent);
                if ($deletedIn->isEmpty()) {
                    continue;
                }
                $ancestors[] = [
                    'nodeAggregateId' => $parent->nodeAggregateId->value,
                    'label' => $this->aggregateLabel($context, $parent, $deletedIn),
                ];
            }
        }

        return $ancestors;
    }

    /**
     * The Neos user behind a content repository user id. The two id worlds are
     * separate: a content repository id that is no Neos user (or no longer
     * one) simply has no label.
     */
    private function resolveUserLabel(string $userId): ?string
    {
        try {
            return $this->userService->findUserById(UserId::fromString($userId))?->getLabel();
        } catch (\InvalidArgumentException) {
            return null;
        }
    }
}
