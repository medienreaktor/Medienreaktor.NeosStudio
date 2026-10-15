<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Controller\Api;

use Medienreaktor\NeosStudio\Service\EventBeforeWindow;
use Medienreaktor\NeosStudio\Service\NodeAddresses;
use Medienreaktor\NeosStudio\Service\NodeLabelRenderer;
use Medienreaktor\NeosStudio\Service\WorkspaceDiffService;
use Medienreaktor\NeosStudio\Service\WorkspaceEventFeed;
use Medienreaktor\NeosStudio\Service\WorkspaceEventFeedFactory;
use Medienreaktor\NeosStudio\Service\WorkspaceHistoryService;
use Medienreaktor\NeosStudio\Service\WorkspaceReadContext;
use Medienreaktor\NeosStudio\Service\WorkspaceSerializer;
use Medienreaktor\NeosStudio\Service\WorkspaceTrashService;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAggregateId;
use Neos\ContentRepository\Core\SharedModel\Workspace\Workspace;
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\SubtreeTagging\NeosSubtreeTag;
use Neos\Neos\PendingChangesProjection\ChangeFinder;

/**
 * The Studio's review, history and trash read models of a workspace - the
 * human-facing views Neos.Api deliberately leaves to its clients: the pending
 * changes grouped by document with labels and breadcrumbs, a document's net
 * diff against the base, the workspace's pending event history with
 * before/after detail per editing step, and the trash enriched for display.
 * Writing (publish, discard, rebase, restore) is Neos.Api's.
 *
 * Every action requires the studio.read scope and read permission on the
 * workspace (Neos' workspace permission model).
 *
 * The heavy lifting lives in services: WorkspaceHistoryService (event feed
 * enrichment), WorkspaceDiffService (before/after change rows),
 * WorkspaceTrashService - all reading through a per-request
 * WorkspaceReadContext that caches subgraphs, ancestor lookups and node-type
 * configuration across the request's fan-out.
 */
class WorkspaceHistoryController extends AbstractStudioApiController
{
    /** Newest events the pending-history resource returns per workspace. */
    private const PENDING_EVENTS_LIMIT = 100;

    /** Widest sequence-number slice one pending-events diff may cover. */
    private const DIFF_RANGE_LIMIT = 200;

    /** Events the before-value scan walks back through, at most. Beyond this
     * window the diff falls back to the base workspace's current value. */
    private const DIFF_SCAN_LIMIT = 500;

    /** Node ids one conflict-details request may describe. */
    private const CONFLICT_DETAILS_LIMIT = 200;

    #[Flow\Inject]
    protected WorkspaceSerializer $workspaceSerializer;

    #[Flow\Inject]
    protected WorkspaceHistoryService $workspaceHistoryService;

    #[Flow\Inject]
    protected WorkspaceDiffService $workspaceDiffService;

    #[Flow\Inject]
    protected WorkspaceTrashService $workspaceTrashService;

    #[Flow\Inject]
    protected NodeLabelRenderer $labelRenderer;

    /**
     * The pending changes of a workspace grouped by their containing document,
     * enriched for a human-facing review UI: each entry carries the document's
     * label, icon, breadcrumb, the kinds of change it contains, and how many
     * pending changes it groups. This is what the Studio's "Review changes"
     * dialog lists and lets an editor publish or discard per document.
     *
     * Granularity is deliberately the document: publish/discard scope to a
     * document (documentAggregateIds), which is the unit the content
     * repository can separate cleanly. Mirrors the document grouping of the
     * classic Workspace module's review table.
     */
    public function documentChangesAction(string $workspaceName): string
    {
        $this->requireScope(self::SCOPE_READ);

        $workspace = $this->requireReadableWorkspace($workspaceName);
        $context = $this->readContext($workspace);
        $changeFinder = $context->contentRepository->projectionState(ChangeFinder::class);

        // Accumulated per document aggregate id, in first-seen order.
        $documents = [];
        // The distinct changed nodes per document: the projection records one
        // row per node AND dimension (a move fans out per covered dimension
        // space point), but the review UI shows no dimensions - counting rows
        // would show phantom changes no user action explains.
        $countedNodeIds = [];
        foreach ($changeFinder->findByContentStreamId($workspace->currentContentStreamId) as $change) {
            $documentNode = null;
            $siteNode = null;
            $documentSubgraph = null;
            if ($change->originDimensionSpacePoint !== null) {
                $dimensionSpacePoint = $change->originDimensionSpacePoint->toDimensionSpacePoint();
                // Shared document/site resolution: the anchor the content
                // repository itself scopes a publish by, plus a base-workspace
                // fallback for hard-removed nodes. A base-resolved document is
                // display-only (label/icon/breadcrumb) - not navigable, hence
                // no subgraph (and a null address below).
                $resolved = $context->changeDocumentAndSite($change, $dimensionSpacePoint);
                $documentNode = $resolved['document'];
                $siteNode = $resolved['site'];
                if ($documentNode !== null && $resolved['inWorkspace']) {
                    $documentSubgraph = $context->subgraph($dimensionSpacePoint);
                }
            }

            $documentId = $documentNode?->aggregateId->value;
            // A change no document can be resolved for cannot be scoped to a
            // document by the content repository either (only a full publish
            // or discard covers it), so there is no bucket to invent here.
            if ($documentId === null) {
                continue;
            }

            if (!isset($documents[$documentId])) {
                $documents[$documentId] = [
                    'documentAggregateId' => $documentId,
                    // Only workspace-resolved documents are navigable - and a
                    // soft-removed one is not: it is deleted as far as every
                    // other resource is concerned.
                    'documentAddress' => $documentSubgraph !== null
                        && !$context->isSoftRemoved($documentNode)
                        ? NodeAddresses::toArray($documentNode)
                        : null,
                    'siteAggregateId' => $siteNode?->aggregateId->value,
                    'siteLabel' => $siteNode !== null ? $context->label($siteNode) : null,
                    'label' => $context->label($documentNode),
                    'nodeType' => $documentNode->nodeTypeName->value,
                    'icon' => $context->icon($documentNode->nodeTypeName),
                    'breadcrumb' => $documentSubgraph !== null
                        ? $context->breadcrumb($documentNode, $documentSubgraph)
                        : [],
                    'hidden' => $documentNode->tags->contain(NeosSubtreeTag::disabled()),
                    'created' => false,
                    'changed' => false,
                    'moved' => false,
                    'deleted' => false,
                    'changeCount' => 0,
                ];
            }

            if (!isset($countedNodeIds[$documentId][$change->nodeAggregateId->value])) {
                $countedNodeIds[$documentId][$change->nodeAggregateId->value] = true;
                $documents[$documentId]['changeCount']++;
            }
            // The document node's own change gives the page-level verbs; any
            // change on a descendant is content that changed within the page.
            // OR-ed, never assigned: the projection keeps one row per node AND
            // dimension, and the verbs differ between them.
            if ($change->nodeAggregateId->equals($documentNode->aggregateId)) {
                $documents[$documentId]['created'] = $documents[$documentId]['created'] || $change->created;
                $documents[$documentId]['moved'] = $documents[$documentId]['moved'] || $change->moved;
                $documents[$documentId]['deleted'] = $documents[$documentId]['deleted'] || $change->deleted;
                $documents[$documentId]['changed'] = $documents[$documentId]['changed'] || $change->changed;
            } else {
                $documents[$documentId]['changed'] = true;
            }
        }

        return $this->json([
            'workspace' => $workspace->workspaceName->value,
            'baseWorkspaceName' => $workspace->baseWorkspaceName?->value,
            'status' => strtolower($workspace->status->value),
            'documents' => array_values($documents),
        ]);
    }

    /**
     * The NET difference one document's changed nodes carry against the base
     * workspace - what publishing this document would actually apply: each
     * changed node's current properties, references, type, name, parent and
     * visibility against the base workspace's version, deduplicated per node
     * VARIANT. A node's `status` is "created", "removed", "moved", "changed" -
     * or "variant" for a dimension variant added on top of content the base
     * workspace already has.
     */
    public function documentDiffAction(string $workspaceName, string $documentAggregateId): string
    {
        $this->requireScope(self::SCOPE_READ);

        $workspace = $this->requireReadableWorkspace($workspaceName);
        $context = $this->readContext($workspace);
        $changeFinder = $context->contentRepository->projectionState(ChangeFinder::class);

        $seenVariants = [];
        $nodes = [];
        foreach ($changeFinder->findByContentStreamId($workspace->currentContentStreamId) as $change) {
            if ($change->originDimensionSpacePoint === null) {
                continue;
            }
            $nodeId = $change->nodeAggregateId;
            $dimensionSpacePoint = $change->originDimensionSpacePoint->toDimensionSpacePoint();
            $subgraph = $context->subgraph($dimensionSpacePoint);
            $baseSubgraph = $context->baseSubgraph($dimensionSpacePoint);

            $wsNode = $subgraph->findNodeById($nodeId);
            $baseNode = $baseSubgraph?->findNodeById($nodeId);
            if ($wsNode === null && $baseNode === null) {
                continue;
            }

            // Belongs to the requested document? Grouped exactly like the
            // listing that offered this document.
            $documentId = $context->changeDocumentAndSite($change, $dimensionSpacePoint)['document']
                ?->aggregateId->value;
            if ($documentId !== $documentAggregateId) {
                continue;
            }

            // Rows fanned out over covered dimensions resolve to the same
            // origin variant - one difference, listed once.
            $node = $wsNode ?? $baseNode;
            $variantKey = $nodeId->value . '|' . $node->originDimensionSpacePoint->hash;
            if (isset($seenVariants[$variantKey])) {
                continue;
            }
            $seenVariants[$variantKey] = true;

            // The pending-changes projection marks a created node aggregate and
            // a created dimension VARIANT of an existing one the same way; an
            // aggregate that already exists in the base cannot have been
            // created in this workspace - what was added is a variant of it.
            $isVariant = $change->created
                && $context->baseContentGraph()?->findNodeAggregateById($nodeId) !== null;
            $status = match (true) {
                $change->deleted => 'removed',
                $isVariant => 'variant',
                $change->created => 'created',
                $change->moved => 'moved',
                default => 'changed',
            };
            $changes = $status === 'removed'
                ? []
                : $this->workspaceDiffService->diffNodeAgainstBase($wsNode, $baseNode, $change->moved, $subgraph, $baseSubgraph, $context);

            // A "changed" node whose state does not differ visibly (e.g.
            // edited and manually reverted) would render as an empty block.
            if ($changes === [] && $status === 'changed') {
                continue;
            }

            $nodes[] = [
                'nodeAggregateId' => $nodeId->value,
                'dimensions' => $node->originDimensionSpacePoint->coordinates,
                'status' => $status,
                'nodeLabel' => $context->label($node),
                'nodeType' => $node->nodeTypeName->value,
                'icon' => $context->icon($node->nodeTypeName),
                'changes' => $changes,
            ];
        }

        return $this->json([
            'workspace' => $workspace->workspaceName->value,
            'baseWorkspaceName' => $workspace->baseWorkspaceName?->value,
            'documentAggregateId' => $documentAggregateId,
            'nodes' => $nodes,
        ]);
    }

    /**
     * The workspace's trash bin: what was deleted in it, newest first,
     * enriched for display. `documentsOnly=1` narrows it to deleted pages.
     * `status` mirrors the workspace: restoring (Neos.Api restoreNode)
     * requires an up-to-date workspace.
     */
    public function trashAction(string $workspaceName, bool $documentsOnly = false): string
    {
        $this->requireScope(self::SCOPE_READ);

        $workspace = $this->requireReadableWorkspace($workspaceName);
        $trash = $this->workspaceTrashService->listItems($this->readContext($workspace), $documentsOnly);

        return $this->json([
            'workspace' => $workspace->workspaceName->value,
            'status' => strtolower($workspace->status->value),
            'items' => $trash['items'],
            // true when more was deleted than this resource enriches at once.
            'truncated' => $trash['truncated'],
        ]);
    }

    /**
     * The pending history of a workspace, oldest first - the events recorded
     * in its current content stream, i.e. every change since the workspace
     * last forked off its base. Events are enriched with the affected node's
     * label/type/icon, the initiating user's name and the containing
     * document, and capped at the newest PENDING_EVENTS_LIMIT entries
     * (truncated=true when older ones were dropped).
     */
    public function pendingEventsAction(string $workspaceName): string
    {
        $this->requireScope(self::SCOPE_READ);

        $workspace = $this->requireReadableWorkspace($workspaceName);
        $feed = $this->eventFeed();
        $envelopes = $feed->latestEvents($workspace->currentContentStreamId, self::PENDING_EVENTS_LIMIT);

        // Where this stream branched off: its first event is the fork event,
        // naming the source stream and the version it had at that moment.
        $forkedFrom = null;
        $firstEvent = $feed->firstEvent($workspace->currentContentStreamId);
        if ($firstEvent !== null && $firstEvent->event->type->value === 'ContentStreamWasForked') {
            $forkPayload = json_decode($firstEvent->event->data->value, true);
            $sourceStream = is_array($forkPayload) ? ($forkPayload['sourceContentStreamId'] ?? null) : null;
            $sourceVersion = is_array($forkPayload) ? ($forkPayload['versionOfSourceContentStream'] ?? null) : null;
            if (is_string($sourceStream) && is_numeric($sourceVersion)) {
                $forkedFrom = [
                    'contentStreamId' => $sourceStream,
                    'version' => (int)$sourceVersion,
                ];
            }
        }

        $events = array_map(
            static fn (array $item): array => $item['event'],
            $this->workspaceHistoryService->enrichFeedEvents($envelopes, $this->readContext($workspace))
        );

        return $this->json([
            'workspace' => $workspace->workspaceName->value,
            'baseWorkspaceName' => $workspace->baseWorkspaceName?->value,
            'status' => strtolower($workspace->status->value),
            'contentStreamId' => $workspace->currentContentStreamId->value,
            'forkedFrom' => $forkedFrom,
            'truncated' => count($envelopes) === self::PENDING_EVENTS_LIMIT,
            'events' => $events,
        ]);
    }

    /**
     * Before/after detail for a slice of a workspace's pending history - the
     * events of one editing step, addressed by the sequence-number range the
     * pending-events resource reported. "Old" is the value just before the
     * event: resolved by scanning the same stream backwards (capped at
     * DIFF_SCAN_LIMIT), falling back to the value the base workspace holds
     * now. null means "did not exist".
     */
    public function pendingEventsDiffAction(string $workspaceName, int $from = 0, int $to = 0): string
    {
        $this->requireScope(self::SCOPE_READ);

        $workspace = $this->requireReadableWorkspace($workspaceName);
        if ($from < 1 || $to < $from || $to - $from >= self::DIFF_RANGE_LIMIT) {
            $this->throwJsonStatus(400, 'invalid_range', sprintf(
                'Provide 1 <= from <= to with a span below %d.',
                self::DIFF_RANGE_LIMIT
            ));
        }

        $feed = $this->eventFeed();
        $slice = $feed->eventsBetween($workspace->currentContentStreamId, $from, $to);

        // The backward-scan window: loaded lazily on the first before-value
        // lookup, decoded once, indexed per node (see EventBeforeWindow).
        $beforeWindow = new EventBeforeWindow(function () use ($feed, $workspace, $from): array {
            $events = [];
            foreach ($feed->eventsBefore($workspace->currentContentStreamId, $from, self::DIFF_SCAN_LIMIT) as $envelope) {
                $payload = json_decode($envelope->event->data->value, true);
                if (is_array($payload)) {
                    $events[] = ['type' => $envelope->event->type->value, 'payload' => $payload];
                }
            }
            return $events;
        });

        $context = $this->readContext($workspace);
        $events = [];
        foreach ($this->workspaceHistoryService->enrichFeedEvents($slice, $context) as $item) {
            $events[] = $item['event'] + [
                'changes' => $this->workspaceDiffService->diffEventChanges(
                    $item['envelope'],
                    $item['payload'],
                    $item['node'],
                    $context,
                    $beforeWindow
                ),
            ];
        }

        return $this->json([
            'workspace' => $workspace->workspaceName->value,
            'contentStreamId' => $workspace->currentContentStreamId->value,
            'from' => $from,
            'to' => $to,
            'events' => $events,
        ]);
    }

    /**
     * Human-readable detail for the nodes of a publish/rebase conflict (which
     * Neos.Api reports by id only): the node's label, its closest document's
     * label and a navigable address of that document (null for a deleted
     * one). Resolved in the workspace across the aggregate's covered
     * dimensions - deleted (soft removed) nodes included - with the base
     * workspace as fallback. Query: nodeAggregateIds, comma-separated.
     */
    public function conflictDetailsAction(string $workspaceName, string $nodeAggregateIds = ''): string
    {
        $this->requireScope(self::SCOPE_READ);

        $workspace = $this->requireReadableWorkspace($workspaceName);
        $ids = array_values(array_unique(array_filter(array_map('trim', explode(',', $nodeAggregateIds)), static fn (string $id) => $id !== '')));
        if (count($ids) > self::CONFLICT_DETAILS_LIMIT) {
            $this->throwJsonStatus(400, 'too_many_nodes', sprintf('At most %d node aggregate ids per request.', self::CONFLICT_DETAILS_LIMIT));
        }

        $context = $this->readContext($workspace);
        $nodes = [];
        foreach ($ids as $id) {
            try {
                $nodeAggregateId = NodeAggregateId::fromString($id);
            } catch (\InvalidArgumentException) {
                continue;
            }
            $affectedNode = null;
            $documentNode = null;
            $inWorkspace = false;
            // Guarded: a resolution failure leaves the entry unnamed rather
            // than failing the whole request.
            try {
                foreach ([$context->contentGraph(), $context->baseContentGraph()] as $index => $contentGraph) {
                    $nodeAggregate = $contentGraph?->findNodeAggregateById($nodeAggregateId);
                    foreach ($nodeAggregate?->coveredDimensionSpacePoints ?? [] as $dimensionSpacePoint) {
                        $subgraph = $index === 0 ? $context->subgraph($dimensionSpacePoint) : $context->baseSubgraph($dimensionSpacePoint);
                        $affectedNode = $subgraph?->findNodeById($nodeAggregateId);
                        $documentNode = $context->closestNode($nodeAggregateId, $dimensionSpacePoint, 'Neos.Neos:Document', inBase: $index === 1);
                        $inWorkspace = $index === 0;
                        break 2;
                    }
                }
            } catch (\Throwable) {
                // Leave node/document null.
            }

            $nodes[] = [
                'nodeAggregateId' => $id,
                'nodeLabel' => $affectedNode !== null ? $this->labelRenderer->label($affectedNode) : null,
                'documentAggregateId' => $documentNode?->aggregateId->value,
                'documentLabel' => $documentNode !== null ? $this->labelRenderer->label($documentNode) : null,
                // No address for a deleted page or one only the base has.
                'documentAddress' => $documentNode !== null && $inWorkspace && !$context->isSoftRemoved($documentNode)
                    ? NodeAddresses::toArray($documentNode)
                    : null,
            ];
        }

        return $this->json([
            'workspace' => $workspace->workspaceName->value,
            'nodes' => $nodes,
        ]);
    }

    /**
     * The workspace by name, or a JSON 404/403: it must exist and the account
     * must have read permission on it.
     */
    private function requireReadableWorkspace(string $workspaceName): Workspace
    {
        try {
            $name = WorkspaceName::fromString($workspaceName);
        } catch (\InvalidArgumentException) {
            $this->throwJsonStatus(400, 'invalid_workspace_name', 'The workspace name is not valid.');
        }
        $workspace = $this->getContentRepository()->findWorkspaceByName($name);
        if ($workspace === null) {
            $this->throwJsonStatus(404, 'workspace_not_found', 'The workspace does not exist.');
        }
        if (!$this->workspaceSerializer->canRead($this->getContentRepositoryId(), $workspace->workspaceName)) {
            $this->throwJsonStatus(403, 'access_denied', 'You have no read access to this workspace.');
        }

        return $workspace;
    }

    /** The request-scoped read context the history/diff services cache through. */
    private function readContext(Workspace $workspace): WorkspaceReadContext
    {
        return new WorkspaceReadContext($this->getContentRepository(), $workspace, $this->labelRenderer);
    }

    private function eventFeed(): WorkspaceEventFeed
    {
        /** @var WorkspaceEventFeed $feed */
        $feed = $this->contentRepositoryRegistry->buildService($this->getContentRepositoryId(), new WorkspaceEventFeedFactory());

        return $feed;
    }
}
