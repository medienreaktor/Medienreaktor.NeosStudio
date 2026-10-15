<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\WorkspaceHistory;

use Medienreaktor\NeosStudio\Endpoint\WorkspaceHistory\Schema\ConflictingNodes;
use Medienreaktor\NeosStudio\Endpoint\WorkspaceHistory\Schema\DocumentChanges;
use Medienreaktor\NeosStudio\Endpoint\WorkspaceHistory\Schema\DocumentDiff;
use Medienreaktor\NeosStudio\Endpoint\WorkspaceHistory\Schema\PendingEvents;
use Medienreaktor\NeosStudio\Endpoint\WorkspaceHistory\Schema\PendingEventsDiff;
use Medienreaktor\NeosStudio\Endpoint\WorkspaceHistory\Schema\Trash;
use Medienreaktor\NeosStudio\Security\StudioCallers;
use Medienreaktor\NeosStudio\Security\StudioScopes;
use Medienreaktor\NeosStudio\Service\EventBeforeWindow;
use Medienreaktor\NeosStudio\Service\NodeAddresses;
use Medienreaktor\NeosStudio\Service\NodeLabelRenderer;
use Medienreaktor\NeosStudio\Service\WorkspaceDiffService;
use Medienreaktor\NeosStudio\Service\WorkspaceEventFeed;
use Medienreaktor\NeosStudio\Service\WorkspaceEventFeedFactory;
use Medienreaktor\NeosStudio\Service\WorkspaceHistoryService;
use Medienreaktor\NeosStudio\Service\WorkspaceReadContext;
use Medienreaktor\NeosStudio\Service\WorkspaceTrashService;
use Neos\Api\Endpoint\ContentRepositories\Schema\ContentRepositoryId;
use Neos\Api\Endpoint\Nodes\Schema\NodeAggregateId;
use Neos\Api\Endpoint\Workspaces\Domain\ReadableWorkspace;
use Neos\Api\Endpoint\Workspaces\Domain\WorkspaceResolver;
use Neos\Api\Endpoint\Workspaces\Schema\ContentStreamId;
use Neos\Api\Endpoint\Workspaces\Schema\SequenceNumber;
use Neos\Api\Endpoint\Workspaces\Schema\WorkspaceName;
use Neos\Api\Endpoint\Workspaces\Schema\WorkspaceStatus;
use Neos\Api\Security\ApiAuthContextProvider;
use Neos\Api\Security\ApiCaller;
use Neos\Api\Shared\Response\BadRequest;
use Neos\Api\Shared\Response\NotFound;
use Neos\ContentRepository\Core\SharedModel;
use Neos\ContentRepositoryRegistry\ContentRepositoryRegistry;
use Neos\Neos\Domain\SubtreeTagging\NeosSubtreeTag;
use Neos\Neos\PendingChangesProjection\ChangeFinder;
use Neos\OpenApi\Attributes\AuthContext;
use Neos\OpenApi\Attributes\Operation;
use Neos\OpenApi\Attributes\Parameter;

/**
 * The review, history and trash of a workspace, for people: what the Neos
 * API's workspace operations leave to their clients
 *
 * The changes by document with labels and breadcrumbs, a document's diff
 * against the base workspace, the events since the workspace was last based
 * on its base with what each changed, the trash, and the nodes of a conflict.
 * Changing anything (publish, discard, rebase, restore) is the Neos API's.
 * A workspace the caller may not read is a 404, as an unknown one.
 *
 * The services read through a WorkspaceReadContext per request, which caches
 * subgraphs, ancestors and node type configuration across the many nodes.
 */
final readonly class WorkspaceHistory
{
    /**
     * The newest events pendingEvents lists
     */
    private const int PENDING_EVENTS_LIMIT = 100;

    /**
     * The widest range of sequence numbers one pendingEventsDiff covers
     */
    private const int DIFF_RANGE_LIMIT = 200;

    /**
     * How many events pendingEventsDiff looks back for a value before them at
     * most, beyond that it takes the base workspace's
     */
    private const int DIFF_SCAN_LIMIT = 500;

    /**
     * How many nodes one conflictingNodes describes at most
     */
    private const int CONFLICTING_NODES_LIMIT = 200;

    public function __construct(
        private WorkspaceResolver $workspaceResolver,
        private ContentRepositoryRegistry $contentRepositoryRegistry,
        private WorkspaceHistoryService $workspaceHistoryService,
        private WorkspaceDiffService $workspaceDiffService,
        private WorkspaceTrashService $workspaceTrashService,
        private NodeLabelRenderer $labelRenderer,
        private StudioCallers $studioCallers,
    ) {
    }

    #[Operation(
        path: '/workspaces/{workspaceName}/documentchanges',
        method: 'GET',
        summary: 'List the changes of a workspace by document',
        description: 'The changes of the workspace grouped by the document they are in, for a review: each document with its label, icon and breadcrumb, how it changed and how many of its nodes did. Publishing and discarding by document (documentAggregateIds of publishWorkspace and discardWorkspace in the Neos API) work on the same documents. Changes no document can be found for are left out, only publishing or discarding everything covers them.',
        operationId: 'listWorkspaceDocumentChanges',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::WORKSPACEHISTORY_READ],
        ],
    )]
    public function documentChanges(#[AuthContext] ApiCaller $caller, WorkspaceName $workspaceName): DocumentChanges|NotFound
    {
        $readable = $this->resolve($caller, $workspaceName);
        if (!$readable instanceof ReadableWorkspace) {
            return $readable;
        }
        $workspace = $readable->workspace;
        $context = $this->readContext($readable);

        // by document, in the order of their first change
        $documents = [];
        // the changed nodes per document: the projection has a row per node AND dimension space point (a move one
        // per covered one), which no change of a user explains
        $countedNodeIds = [];
        foreach ($context->contentRepository->projectionState(ChangeFinder::class)->findByContentStreamId($workspace->currentContentStreamId) as $change) {
            $documentNode = null;
            $siteNode = null;
            $documentSubgraph = null;
            if ($change->originDimensionSpacePoint !== null) {
                $dimensionSpacePoint = $change->originDimensionSpacePoint->toDimensionSpacePoint();
                // the document the content repository scopes a publish by, from the base workspace for a node
                // removed for good: only to be shown then, not navigable
                $resolved = $context->changeDocumentAndSite($change, $dimensionSpacePoint);
                $documentNode = $resolved['document'];
                $siteNode = $resolved['site'];
                if ($documentNode !== null && $resolved['inWorkspace']) {
                    $documentSubgraph = $context->subgraph($dimensionSpacePoint);
                }
            }
            if ($documentNode === null) {
                continue;
            }
            $documentId = $documentNode->aggregateId->value;
            $documents[$documentId] ??= [
                'documentAggregateId' => $documentId,
                // a deleted document is gone for every other operation
                'documentAddress' => $documentSubgraph !== null && !$context->isSoftRemoved($documentNode)
                    ? NodeAddresses::toArray($documentNode)
                    : null,
                'siteAggregateId' => $siteNode?->aggregateId->value,
                'siteLabel' => $siteNode !== null ? $context->label($siteNode) : null,
                'label' => $context->label($documentNode),
                'nodeType' => $documentNode->nodeTypeName->value,
                'icon' => $context->icon($documentNode->nodeTypeName),
                'breadcrumb' => $documentSubgraph !== null ? $context->breadcrumb($documentNode, $documentSubgraph) : [],
                'hidden' => $documentNode->tags->contain(NeosSubtreeTag::disabled()),
                'created' => false,
                'changed' => false,
                'moved' => false,
                'deleted' => false,
                'changeCount' => 0,
            ];
            if (!isset($countedNodeIds[$documentId][$change->nodeAggregateId->value])) {
                $countedNodeIds[$documentId][$change->nodeAggregateId->value] = true;
                $documents[$documentId]['changeCount']++;
            }
            // the document's own change says what happened to the page, any other is content in it that changed.
            // OR-ed: the rows of one node differ between dimension space points
            if ($change->nodeAggregateId->equals($documentNode->aggregateId)) {
                $documents[$documentId]['created'] = $documents[$documentId]['created'] || $change->created;
                $documents[$documentId]['moved'] = $documents[$documentId]['moved'] || $change->moved;
                $documents[$documentId]['deleted'] = $documents[$documentId]['deleted'] || $change->deleted;
                $documents[$documentId]['changed'] = $documents[$documentId]['changed'] || $change->changed;
            } else {
                $documents[$documentId]['changed'] = true;
            }
        }

        return new DocumentChanges(
            $workspaceName,
            self::baseWorkspaceNameOf($workspace),
            self::statusOf($workspace),
            array_values($documents),
        );
    }

    #[Operation(
        path: '/workspaces/{workspaceName}/documentdiff',
        method: 'GET',
        summary: 'Get the diff of a document of a workspace',
        description: 'What publishing the document (as listed by listWorkspaceDocumentChanges) would change in the base workspace: each of its changed nodes, each dimension variant once, with its properties, references, node type, name, parent and visibility before (base workspace) and after (workspace). A node edited back to what it was is left out. status variant is a dimension variant of a node the base workspace has.',
        operationId: 'getWorkspaceDocumentDiff',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::WORKSPACEHISTORY_READ],
        ],
    )]
    public function documentDiff(
        #[AuthContext] ApiCaller $caller,
        WorkspaceName $workspaceName,
        #[Parameter(in: 'query', description: 'The document, as documentAggregateId of listWorkspaceDocumentChanges')]
        NodeAggregateId $documentAggregateId,
    ): DocumentDiff|NotFound {
        $readable = $this->resolve($caller, $workspaceName);
        if (!$readable instanceof ReadableWorkspace) {
            return $readable;
        }
        $workspace = $readable->workspace;
        $context = $this->readContext($readable);

        $seenVariants = [];
        $nodes = [];
        foreach ($context->contentRepository->projectionState(ChangeFinder::class)->findByContentStreamId($workspace->currentContentStreamId) as $change) {
            if ($change->originDimensionSpacePoint === null) {
                continue;
            }
            $nodeId = $change->nodeAggregateId;
            $dimensionSpacePoint = $change->originDimensionSpacePoint->toDimensionSpacePoint();
            $subgraph = $context->subgraph($dimensionSpacePoint);
            $baseSubgraph = $context->baseSubgraph($dimensionSpacePoint);
            $workspaceNode = $subgraph->findNodeById($nodeId);
            $baseNode = $baseSubgraph?->findNodeById($nodeId);
            if ($workspaceNode === null && $baseNode === null) {
                continue;
            }
            // grouped exactly as listWorkspaceDocumentChanges does
            if ($context->changeDocumentAndSite($change, $dimensionSpacePoint)['document']?->aggregateId->value !== $documentAggregateId->value) {
                continue;
            }
            // rows of the dimension space points a variant covers are one difference
            $node = $workspaceNode ?? $baseNode;
            $variantKey = $nodeId->value . '|' . $node->originDimensionSpacePoint->hash;
            if (isset($seenVariants[$variantKey])) {
                continue;
            }
            $seenVariants[$variantKey] = true;

            // the projection marks a new dimension variant as created like a new node: one the base workspace has
            // can't have been created in this workspace
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
                : $this->workspaceDiffService->diffNodeAgainstBase($workspaceNode, $baseNode, $change->moved, $subgraph, $baseSubgraph, $context);
            // edited and changed back: nothing to show
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

        return new DocumentDiff($workspaceName, self::baseWorkspaceNameOf($workspace), $documentAggregateId, $nodes);
    }

    #[Operation(
        path: '/workspaces/{workspaceName}/pendingevents',
        method: 'GET',
        summary: 'List what happened in a workspace',
        description: 'The events of the workspace\'s content stream, i.e. since it was last based on its base workspace (created, published, discarded or rebased), oldest first: the newest 100, truncated says if there were more. Each with its node, the closest document and who caused it, for display; the events of one editing step share user and initiatingTimestamp. forkedFrom says where the content stream branched off its base\'s.',
        operationId: 'listWorkspacePendingEvents',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::WORKSPACEHISTORY_READ],
        ],
    )]
    public function pendingEvents(#[AuthContext] ApiCaller $caller, WorkspaceName $workspaceName): PendingEvents|NotFound
    {
        $readable = $this->resolve($caller, $workspaceName);
        if (!$readable instanceof ReadableWorkspace) {
            return $readable;
        }
        $workspace = $readable->workspace;
        $feed = $this->eventFeed();
        $envelopes = $feed->latestEvents($workspace->currentContentStreamId, self::PENDING_EVENTS_LIMIT);

        // the first event of a forked stream names the source stream and its version then
        $forkedFrom = null;
        $firstEvent = $feed->firstEvent($workspace->currentContentStreamId);
        if ($firstEvent !== null && $firstEvent->event->type->value === 'ContentStreamWasForked') {
            $forkPayload = json_decode($firstEvent->event->data->value, true);
            $sourceStream = is_array($forkPayload) ? ($forkPayload['sourceContentStreamId'] ?? null) : null;
            $sourceVersion = is_array($forkPayload) ? ($forkPayload['versionOfSourceContentStream'] ?? null) : null;
            if (is_string($sourceStream) && is_numeric($sourceVersion)) {
                $forkedFrom = ['contentStreamId' => $sourceStream, 'version' => (int)$sourceVersion];
            }
        }

        return new PendingEvents(
            $workspaceName,
            self::baseWorkspaceNameOf($workspace),
            self::statusOf($workspace),
            ContentStreamId::from($workspace->currentContentStreamId),
            $forkedFrom,
            count($envelopes) === self::PENDING_EVENTS_LIMIT,
            array_map(
                static fn (array $item): array => $item['event'],
                $this->workspaceHistoryService->enrichFeedEvents($envelopes, $this->readContext($readable)),
            ),
        );
    }

    #[Operation(
        path: '/workspaces/{workspaceName}/pendingevents/diff',
        method: 'GET',
        summary: 'Get what events of a workspace changed',
        description: 'The events from one sequence number to another (as listWorkspacePendingEvents lists them, e.g. one editing step), each with what it changed: the value before is the one of the latest event before it (looking back 500 events at most), else the base workspace\'s. A range wider than 200 or with to before from is a 400.',
        operationId: 'getWorkspacePendingEventsDiff',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::WORKSPACEHISTORY_READ],
        ],
    )]
    public function pendingEventsDiff(
        #[AuthContext] ApiCaller $caller,
        WorkspaceName $workspaceName,
        #[Parameter(in: 'query', description: 'The sequence number of the first event')]
        SequenceNumber $from,
        #[Parameter(in: 'query', description: 'The sequence number of the last event')]
        SequenceNumber $to,
    ): PendingEventsDiff|NotFound|BadRequest {
        if ($to->value < $from->value || $to->value - $from->value >= self::DIFF_RANGE_LIMIT) {
            return BadRequest::because(sprintf('to must not be before from, and the range must be narrower than %d', self::DIFF_RANGE_LIMIT));
        }
        $readable = $this->resolve($caller, $workspaceName);
        if (!$readable instanceof ReadableWorkspace) {
            return $readable;
        }
        $workspace = $readable->workspace;
        $feed = $this->eventFeed();
        $slice = $feed->eventsBetween($workspace->currentContentStreamId, $from->value, $to->value);

        // the events before the range, loaded on the first lookup of a value before an event, decoded once
        $beforeWindow = new EventBeforeWindow(function () use ($feed, $workspace, $from): array {
            $events = [];
            foreach ($feed->eventsBefore($workspace->currentContentStreamId, $from->value, self::DIFF_SCAN_LIMIT) as $envelope) {
                $payload = json_decode($envelope->event->data->value, true);
                if (is_array($payload)) {
                    $events[] = ['type' => $envelope->event->type->value, 'payload' => $payload];
                }
            }
            return $events;
        });

        $context = $this->readContext($readable);
        $events = [];
        foreach ($this->workspaceHistoryService->enrichFeedEvents($slice, $context) as $item) {
            $events[] = $item['event'] + [
                'changes' => $this->workspaceDiffService->diffEventChanges($item['envelope'], $item['payload'], $item['node'], $context, $beforeWindow),
            ];
        }

        return new PendingEventsDiff($workspaceName, ContentStreamId::from($workspace->currentContentStreamId), $from, $to, $events);
    }

    #[Operation(
        path: '/workspaces/{workspaceName}/trash',
        method: 'GET',
        summary: 'List what was deleted in a workspace',
        description: 'The nodes deleted in the workspace and not yet published, newest first, for display: restoreNode of the Neos API brings them back (with the deleted ancestors they are in), which needs an up_to_date workspace. filterByDocuments lists deleted documents only.',
        operationId: 'listWorkspaceTrash',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::WORKSPACEHISTORY_READ],
        ],
    )]
    public function trash(
        #[AuthContext] ApiCaller $caller,
        WorkspaceName $workspaceName,
        #[Parameter(in: 'query', description: 'true lists deleted documents only')]
        bool $filterByDocuments = false,
    ): Trash|NotFound {
        $readable = $this->resolve($caller, $workspaceName);
        if (!$readable instanceof ReadableWorkspace) {
            return $readable;
        }
        $trash = $this->workspaceTrashService->listItems($this->readContext($readable), $filterByDocuments);
        return new Trash($workspaceName, self::statusOf($readable->workspace), $trash['items'], $trash['truncated']);
    }

    #[Operation(
        path: '/workspaces/{workspaceName}/conflictingnodes',
        method: 'GET',
        summary: 'Describe the nodes of a conflict',
        description: 'The nodes a conflict of publishWorkspace or rebaseWorkspace of the Neos API names by ID, with their labels and closest documents, found in the workspace in any dimension space point (deleted ones included), else in the base workspace. A document only the base workspace has, or a deleted one, has no address. At most 200 IDs, more are a 400.',
        operationId: 'listWorkspaceConflictingNodes',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::WORKSPACEHISTORY_READ],
        ],
    )]
    public function conflictingNodes(
        #[AuthContext] ApiCaller $caller,
        WorkspaceName $workspaceName,
        #[Parameter(in: 'query', description: 'The IDs of the nodes, comma separated')]
        string $nodeAggregateIds,
    ): ConflictingNodes|NotFound|BadRequest {
        $ids = array_values(array_unique(array_filter(array_map(trim(...), explode(',', $nodeAggregateIds)), static fn (string $id) => $id !== '')));
        if (count($ids) > self::CONFLICTING_NODES_LIMIT) {
            return BadRequest::because(sprintf('At most %d node aggregate IDs', self::CONFLICTING_NODES_LIMIT));
        }
        $readable = $this->resolve($caller, $workspaceName);
        if (!$readable instanceof ReadableWorkspace) {
            return $readable;
        }
        $context = $this->readContext($readable);
        $nodes = [];
        foreach ($ids as $id) {
            try {
                $nodeAggregateId = SharedModel\Node\NodeAggregateId::fromString($id);
            } catch (\InvalidArgumentException) {
                return BadRequest::because(sprintf('%s is no node aggregate ID', $id));
            }
            $affectedNode = null;
            $documentNode = null;
            $inWorkspace = false;
            // a node that can't be resolved stays without labels rather than failing all
            try {
                foreach ([$context->contentGraph(), $context->baseContentGraph()] as $index => $contentGraph) {
                    foreach ($contentGraph?->findNodeAggregateById($nodeAggregateId)?->coveredDimensionSpacePoints ?? [] as $dimensionSpacePoint) {
                        $subgraph = $index === 0 ? $context->subgraph($dimensionSpacePoint) : $context->baseSubgraph($dimensionSpacePoint);
                        $affectedNode = $subgraph?->findNodeById($nodeAggregateId);
                        $documentNode = $context->closestNode($nodeAggregateId, $dimensionSpacePoint, 'Neos.Neos:Document', inBase: $index === 1);
                        $inWorkspace = $index === 0;
                        break 2;
                    }
                }
            } catch (\Throwable) {
            }
            $nodes[] = [
                'nodeAggregateId' => $id,
                'nodeLabel' => $affectedNode !== null ? $this->labelRenderer->label($affectedNode) : null,
                'documentAggregateId' => $documentNode?->aggregateId->value,
                'documentLabel' => $documentNode !== null ? $this->labelRenderer->label($documentNode) : null,
                'documentAddress' => $documentNode !== null && $inWorkspace && !$context->isSoftRemoved($documentNode)
                    ? NodeAddresses::toArray($documentNode)
                    : null,
            ];
        }
        return new ConflictingNodes($workspaceName, $nodes);
    }

    /**
     * The workspace in the Studio's content repository, the same 404 for one
     * the caller may not read as for an unknown one
     */
    private function resolve(ApiCaller $caller, WorkspaceName $workspaceName): ReadableWorkspace|NotFound
    {
        return $this->workspaceResolver->resolve(
            ContentRepositoryId::fromString($this->studioCallers->contentRepositoryId()->value),
            $workspaceName,
            $caller->account,
        );
    }

    private function readContext(ReadableWorkspace $readable): WorkspaceReadContext
    {
        return new WorkspaceReadContext($readable->contentRepository, $readable->workspace, $this->labelRenderer);
    }

    private function eventFeed(): WorkspaceEventFeed
    {
        /** @var WorkspaceEventFeed $feed */
        $feed = $this->contentRepositoryRegistry->buildService($this->studioCallers->contentRepositoryId(), new WorkspaceEventFeedFactory());
        return $feed;
    }

    private static function baseWorkspaceNameOf(SharedModel\Workspace\Workspace $workspace): ?WorkspaceName
    {
        return $workspace->baseWorkspaceName !== null ? WorkspaceName::fromString($workspace->baseWorkspaceName->value) : null;
    }

    private static function statusOf(SharedModel\Workspace\Workspace $workspace): WorkspaceStatus
    {
        return WorkspaceStatus::from(strtolower($workspace->status->value));
    }
}
