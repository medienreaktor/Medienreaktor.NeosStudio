<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

use Neos\ContentRepository\Core\Factory\ContentRepositoryServiceInterface;
use Neos\ContentRepository\Core\Feature\ContentStreamEventStreamName;
use Neos\ContentRepository\Core\SharedModel\Workspace\ContentStreamId;
use Neos\EventStore\EventStoreInterface;
use Neos\EventStore\Model\Event\SequenceNumber;
use Neos\EventStore\Model\EventEnvelope;

/**
 * Tails a workspace's content stream in the event store - the read side of
 * the collaboration change feed. One content stream is one totally ordered
 * event log, so "what happened since sequence number N" is a single range
 * read; clients poll it and update their UI from the answer.
 *
 * Cursors are the event store's GLOBAL sequence numbers (not per-stream
 * versions): they are monotonic across content streams, so a client cursor
 * stays comparable when a publish/discard/rebase forks the workspace onto a
 * new content stream (which clients detect via the contentStreamId changing).
 *
 * Built through the content-repository service-factory mechanism because the
 * event store is internal to the CR instance ({@see WorkspaceEventFeedFactory}).
 * ContentStreamEventStreamName is @internal in the CR core - the same kind of
 * dependency the changes resource has on ChangeFinder; revisit when a public
 * event-feed API lands upstream.
 */
final class WorkspaceEventFeed implements ContentRepositoryServiceInterface
{
    public function __construct(
        private readonly EventStoreInterface $eventStore,
    ) {
    }

    /**
     * The sequence number of the newest event in the content stream - the
     * cursor a client starts tailing from. 0 for a (theoretical) empty stream.
     */
    public function latestSequenceNumber(ContentStreamId $contentStreamId): int
    {
        $streamName = ContentStreamEventStreamName::fromContentStreamId($contentStreamId)->getEventStreamName();
        foreach ($this->eventStore->load($streamName)->backwards()->limit(1) as $eventEnvelope) {
            return $eventEnvelope->sequenceNumber->value;
        }

        return 0;
    }

    /**
     * The events of the content stream after the given cursor, oldest first,
     * capped at $limit (callers treat a full page as "truncated" and fall
     * back to a wholesale refresh).
     *
     * @return list<EventEnvelope>
     */
    public function eventsSince(ContentStreamId $contentStreamId, int $sinceSequenceNumber, int $limit): array
    {
        $streamName = ContentStreamEventStreamName::fromContentStreamId($contentStreamId)->getEventStreamName();
        $stream = $this->eventStore->load($streamName)
            ->withMinimumSequenceNumber(SequenceNumber::fromInteger($sinceSequenceNumber + 1))
            ->limit($limit);

        return iterator_to_array($stream, false);
    }

    /**
     * The first event of the content stream - for workspace streams that is
     * the ContentStreamWasForked event recording where (source stream and
     * version) the workspace branched off its base.
     */
    public function firstEvent(ContentStreamId $contentStreamId): ?EventEnvelope
    {
        $streamName = ContentStreamEventStreamName::fromContentStreamId($contentStreamId)->getEventStreamName();
        foreach ($this->eventStore->load($streamName)->limit(1) as $eventEnvelope) {
            return $eventEnvelope;
        }

        return null;
    }

    /**
     * The newest $limit events of the content stream, oldest first. A
     * workspace's content stream is forked off its base on publish/discard/
     * rebase, so the whole stream IS the workspace's pending history - this
     * reads its tail without paging through arbitrarily long streams (live!)
     * from the front.
     *
     * @return list<EventEnvelope>
     */
    public function latestEvents(ContentStreamId $contentStreamId, int $limit): array
    {
        $streamName = ContentStreamEventStreamName::fromContentStreamId($contentStreamId)->getEventStreamName();
        $stream = $this->eventStore->load($streamName)->backwards()->limit($limit);

        return array_reverse(iterator_to_array($stream, false));
    }

    /**
     * The events of the content stream with $from <= sequenceNumber <= $to,
     * oldest first - one step of the pending history, for the diff resource.
     *
     * @return list<EventEnvelope>
     */
    public function eventsBetween(ContentStreamId $contentStreamId, int $from, int $to): array
    {
        $streamName = ContentStreamEventStreamName::fromContentStreamId($contentStreamId)->getEventStreamName();
        $stream = $this->eventStore->load($streamName)
            ->withMinimumSequenceNumber(SequenceNumber::fromInteger($from))
            ->withMaximumSequenceNumber(SequenceNumber::fromInteger($to));

        return iterator_to_array($stream, false);
    }

    /**
     * The newest $limit events of the content stream BEFORE the given
     * sequence number, newest first - the backward-scan window a diff walks
     * to find the value a property had before a change.
     *
     * @return list<EventEnvelope>
     */
    public function eventsBefore(ContentStreamId $contentStreamId, int $beforeSequenceNumber, int $limit): array
    {
        if ($beforeSequenceNumber <= 1) {
            return [];
        }
        $streamName = ContentStreamEventStreamName::fromContentStreamId($contentStreamId)->getEventStreamName();
        $stream = $this->eventStore->load($streamName)
            ->withMaximumSequenceNumber(SequenceNumber::fromInteger($beforeSequenceNumber - 1))
            ->backwards()
            ->limit($limit);

        return iterator_to_array($stream, false);
    }
}
