<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

/**
 * The backward-scan window of a pending-events diff: the events recorded just
 * before the diffed range, newest first, indexed by affected node aggregate.
 *
 * Every before-value lookup (property, reference targets, node type, name,
 * parent) walks the past writes of ONE node - indexing the window once turns
 * what used to be a full-window scan per property row into a walk over that
 * node's own events. Loading and indexing happen lazily on the first lookup:
 * ranges whose events never look into the past (creations, tags) pay nothing.
 */
final class EventBeforeWindow
{
    /** @var array<string, list<array{type: string, payload: array<string, mixed>}>>|null */
    private ?array $eventsByNode = null;

    /**
     * @param \Closure(): list<array{type: string, payload: array<string, mixed>}> $loader
     *        yields the window's decoded events, newest first
     */
    public function __construct(private readonly \Closure $loader)
    {
    }

    /**
     * The window's events affecting one node aggregate, newest first.
     *
     * @return list<array{type: string, payload: array<string, mixed>}>
     */
    public function eventsFor(string $nodeAggregateId): array
    {
        if ($this->eventsByNode === null) {
            $this->eventsByNode = [];
            foreach (($this->loader)() as $event) {
                $eventNodeId = $event['payload']['nodeAggregateId'] ?? null;
                if (is_string($eventNodeId)) {
                    $this->eventsByNode[$eventNodeId][] = $event;
                }
            }
        }

        return $this->eventsByNode[$nodeAggregateId] ?? [];
    }
}
