<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\WorkspaceHistory\Schema;

use Neos\Api\Endpoint\Workspaces\Schema\ContentStreamId;
use Neos\Api\Endpoint\Workspaces\Schema\SequenceNumber;
use Neos\Api\Endpoint\Workspaces\Schema\WorkspaceName;
use Neos\JsonSchema\ArraySchema;
use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\Support\ObjectProperties;

/**
 * What some events of a workspace changed, before and after
 *
 * The schema is written out: the events are arrays
 */
final readonly class PendingEventsDiff implements ProvidesSchema
{
    /**
     * @param list<array<string, mixed>> $events
     */
    public function __construct(
        public WorkspaceName $workspaceName,
        public ContentStreamId $contentStreamId,
        public SequenceNumber $from,
        public SequenceNumber $to,
        public array $events,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        $properties = iterator_to_array(PendingEvent::properties());
        return $schema ??= ObjectSchema::create(
            description: 'What the events from one sequence number to another changed',
            properties: ObjectProperties::create(
                workspaceName: WorkspaceName::schema(),
                contentStreamId: ContentStreamId::schema(),
                from: SequenceNumber::schema(),
                to: SequenceNumber::schema(),
                events: ArraySchema::create(
                    description: 'The events in the range, oldest first, each with what it changed',
                    items: ObjectSchema::create(
                        properties: ObjectProperties::create(
                            ...$properties,
                            changes: ArraySchema::create(items: ValueChange::schema()),
                        ),
                        additionalProperties: false,
                        required: [...array_keys($properties), 'changes'],
                    ),
                ),
            ),
            additionalProperties: false,
            required: ['workspaceName', 'contentStreamId', 'from', 'to', 'events'],
        );
    }
}
