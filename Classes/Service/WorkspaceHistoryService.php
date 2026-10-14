<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

use Neos\ContentRepository\Core\Projection\ContentGraph\ContentSubgraphInterface;
use Neos\ContentRepository\Core\Projection\ContentGraph\Filter\FindClosestNodeFilter;
use Neos\ContentRepository\Core\Projection\ContentGraph\Node;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAddress;
use Neos\EventStore\Model\EventEnvelope;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\Model\UserId;
use Neos\Neos\Domain\Service\UserService;

/**
 * Serializes and enriches workspace event-stream envelopes into the Studio's
 * change-feed / pending-history representation: the event's client-facing
 * fields, the affected node's label/type/icon, the initiating user's name,
 * and the containing document (id, label and a navigable address - what
 * "go to page" on a history entry follows).
 *
 * Payload fields are read from the raw event JSON - stable across event types
 * without importing every event class - and each envelope's payload is decoded
 * exactly once: the decoded form travels with the enriched item so the diff
 * layer never re-parses it.
 */
#[Flow\Scope('singleton')]
class WorkspaceHistoryService
{
    #[Flow\Inject]
    protected UserService $userService;

    /**
     * How feed clients should react to an event type: 'content' = a node's
     * rendered element / properties changed (re-render in place), 'structure'
     * = the node tree changed shape (refresh trees, reload the preview).
     * Event types not listed (stream bookkeeping like ContentStreamWasForked)
     * are not surfaced to clients.
     */
    public const FEED_EVENT_KINDS = [
        'NodePropertiesWereSet' => 'content',
        'NodeReferencesWereSet' => 'content',
        'NodeAggregateWithNodeWasCreated' => 'structure',
        'NodeAggregateWasMoved' => 'structure',
        'NodeAggregateWasRemoved' => 'structure',
        'SubtreeWasTagged' => 'structure',
        'SubtreeWasUntagged' => 'structure',
        'NodeAggregateTypeWasChanged' => 'structure',
        'NodeAggregateNameWasChanged' => 'structure',
        'NodeSpecializationVariantWasCreated' => 'structure',
        'NodeGeneralizationVariantWasCreated' => 'structure',
        'NodePeerVariantWasCreated' => 'structure',
    ];

    /**
     * One change-feed event as clients consume it plus its decoded payload,
     * or null for event types the feed does not surface.
     *
     * @return array{event: array<string, mixed>, payload: array<string, mixed>}|null
     */
    public function parseFeedEvent(EventEnvelope $envelope): ?array
    {
        $type = $envelope->event->type->value;
        $kind = self::FEED_EVENT_KINDS[$type] ?? null;
        if ($kind === null) {
            return null;
        }

        $payload = json_decode($envelope->event->data->value, true);
        $payload = is_array($payload) ? $payload : [];

        // The dimension space points an event names, whatever it calls them -
        // single points and sets alike. Clients treat an empty list as
        // "affects every dimension".
        $dimensionSpacePoints = [];
        foreach (['originDimensionSpacePoint', 'coveredDimensionSpacePoint', 'dimensionSpacePoint', 'sourceOrigin', 'targetOrigin', 'specializationOrigin', 'generalizationOrigin', 'peerOrigin'] as $pointKey) {
            if (is_array($payload[$pointKey] ?? null)) {
                $dimensionSpacePoints[] = $payload[$pointKey];
            }
        }
        foreach (['affectedDimensionSpacePoints', 'affectedOccupiedDimensionSpacePoints', 'affectedCoveredDimensionSpacePoints', 'affectedSourceOriginDimensionSpacePoints'] as $setKey) {
            if (is_array($payload[$setKey] ?? null)) {
                foreach ($payload[$setKey] as $point) {
                    if (is_array($point)) {
                        $dimensionSpacePoints[] = $point;
                    }
                }
            }
        }

        $event = [
            'sequenceNumber' => $envelope->sequenceNumber->value,
            // The event's 0-based position within its content stream -
            // comparable with a fork's versionOfSourceContentStream, which is
            // how clients locate a workspace's branch point in its base.
            'version' => $envelope->version->value,
            'type' => $type,
            'kind' => $kind,
            'nodeAggregateId' => is_string($payload['nodeAggregateId'] ?? null)
                ? $payload['nodeAggregateId']
                : (is_string($payload['sourceNodeAggregateId'] ?? null) ? $payload['sourceNodeAggregateId'] : null),
            // The collection a structural change happened inside, when the
            // event knows it - lets clients refresh that subtree.
            'parentNodeAggregateId' => is_string($payload['parentNodeAggregateId'] ?? null)
                ? $payload['parentNodeAggregateId']
                : (is_string($payload['newParentNodeAggregateId'] ?? null) ? $payload['newParentNodeAggregateId'] : null),
            'dimensionSpacePoints' => $dimensionSpacePoints,
            // Which subtree tag a Subtree(Un)Tagged event carries: the
            // difference between hiding a node ("disabled") and deleting it
            // ("removed" - a soft removal) is one event type, two user actions.
            'tag' => is_string($payload['tag'] ?? null) ? $payload['tag'] : null,
            'initiatingUserId' => $envelope->event->metadata?->get('initiatingUserId'),
            'recordedAt' => $envelope->recordedAt->format(\DateTimeInterface::ATOM),
            // The originating command (short class name) and the moment it was
            // handled, from the metadata the CR keeps for rebasing. Together
            // with the user they identify one editing step: all events of one
            // command share one initiatingTimestamp, and unlike the events'
            // correlation id these survive a rebase/partial publish (which
            // re-stamps correlation ids but never touches this metadata).
            'command' => is_string($commandClass = $envelope->event->metadata?->get('commandClass'))
                ? substr($commandClass, (int)strrpos($commandClass, '\\') + 1)
                : null,
            'initiatingTimestamp' => $envelope->event->metadata?->get('initiatingTimestamp'),
        ];

        return ['event' => $event, 'payload' => $payload];
    }

    /**
     * Serialize and enrich feed events. The node is resolved in the
     * workspace's own subgraph, falling back to the base for nodes removed in
     * the workspace, in the dimension the event names (same fallback the
     * changes resources use). Envelopes whose event type is not client-facing
     * are dropped.
     *
     * @param list<EventEnvelope> $envelopes
     * @return list<array{event: array<string, mixed>, payload: array<string, mixed>, envelope: EventEnvelope, node: ?Node, subgraph: ?ContentSubgraphInterface}>
     */
    public function enrichFeedEvents(array $envelopes, WorkspaceReadContext $context): array
    {
        $documentNodes = [];
        $userLabels = [];
        $items = [];
        foreach ($envelopes as $envelope) {
            $parsed = $this->parseFeedEvent($envelope);
            if ($parsed === null) {
                continue;
            }
            $serialized = $parsed['event'];

            [$node, $subgraph] = $context->resolveNode(
                $serialized['nodeAggregateId'],
                $serialized['dimensionSpacePoints'][0] ?? null
            );

            // Cached per node: consecutive events usually hit the same few nodes.
            $documentNode = null;
            if ($node !== null && $subgraph !== null) {
                $documentCacheKey = $node->aggregateId->value . '|' . $node->originDimensionSpacePoint->hash;
                if (!array_key_exists($documentCacheKey, $documentNodes)) {
                    try {
                        $documentNodes[$documentCacheKey] = $subgraph->findClosestNode(
                            $node->aggregateId,
                            FindClosestNodeFilter::create(nodeTypes: 'Neos.Neos:Document')
                        );
                    } catch (\Throwable) {
                        $documentNodes[$documentCacheKey] = null;
                    }
                }
                $documentNode = $documentNodes[$documentCacheKey];
            }

            $userId = $serialized['initiatingUserId'];
            if (is_string($userId) && !array_key_exists($userId, $userLabels)) {
                try {
                    $userLabels[$userId] = $this->userService->findUserById(UserId::fromString($userId))?->getLabel();
                } catch (\InvalidArgumentException) {
                    $userLabels[$userId] = null;
                }
            }

            $items[] = [
                'event' => $serialized + [
                    'nodeLabel' => $node !== null ? $context->label($node) : null,
                    'nodeType' => $node?->nodeTypeName->value,
                    'icon' => $node !== null ? $context->icon($node->nodeTypeName) : null,
                    'initiatingUserLabel' => is_string($userId) ? ($userLabels[$userId] ?? null) : null,
                    'documentAggregateId' => $documentNode?->aggregateId->value,
                    'documentLabel' => $documentNode !== null ? $context->label($documentNode) : null,
                    'documentAddress' => $documentNode !== null
                        ? NodeAddressCodec::encode(NodeAddress::fromNode($documentNode))
                        : null,
                ],
                'payload' => $parsed['payload'],
                'envelope' => $envelope,
                'node' => $node,
                'subgraph' => $subgraph,
            ];
        }

        return $items;
    }
}
