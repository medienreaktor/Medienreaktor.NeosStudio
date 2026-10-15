<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

use Neos\EventStore\Model\EventEnvelope;
use Neos\Flow\Annotations as Flow;

/**
 * Classifies workspace event-stream envelopes into the Studio's change feed
 * (the realtime sidecar's, see RealtimeController): the event's client-facing
 * fields. The shell classifies Neos.Api's workspace events the same way
 * (features/collaboration/eventFeed.ts); the pending history, its diffs, the
 * review and the trash read Neos.Api's workspace changes and events.
 *
 * Payload fields are read from the raw event JSON - stable across event types
 * without importing every event class.
 */
#[Flow\Scope('singleton')]
class WorkspaceHistoryService
{
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
}
