<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\WorkspaceHistory\Schema;

use Neos\Api\Endpoint\Workspaces\Schema\ContentStreamId;
use Neos\Api\Endpoint\Workspaces\Schema\WorkspaceName;
use Neos\Api\Endpoint\Workspaces\Schema\WorkspaceStatus;
use Neos\JsonSchema\ArraySchema;
use Neos\JsonSchema\BooleanSchema;
use Neos\JsonSchema\IntegerSchema;
use Neos\JsonSchema\Nullable;
use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\Support\ObjectProperties;

/**
 * What happened in a workspace since it was last based on its base workspace
 *
 * The schema is written out: the events are arrays
 */
final readonly class PendingEvents implements ProvidesSchema
{
    /**
     * @param array{contentStreamId: string, version: int}|null $forkedFrom
     * @param list<array<string, mixed>> $events
     */
    public function __construct(
        public WorkspaceName $workspaceName,
        public ?WorkspaceName $baseWorkspaceName,
        public WorkspaceStatus $status,
        public ContentStreamId $contentStreamId,
        public ?array $forkedFrom,
        public bool $truncated,
        public array $events,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'The events of the workspace\'s content stream, i.e. since it was last based on its base workspace',
            properties: ObjectProperties::create(
                workspaceName: WorkspaceName::schema(),
                baseWorkspaceName: Nullable::wrap(WorkspaceName::schema()),
                status: WorkspaceStatus::schema(),
                contentStreamId: ContentStreamId::schema(),
                forkedFrom: Nullable::wrap(ObjectSchema::create(
                    description: 'Where the content stream branched off: the base\'s content stream and its version then. Events of the base with a higher version happened since, they make the workspace outdated. null for a root workspace',
                    properties: ObjectProperties::create(
                        contentStreamId: ContentStreamId::schema(),
                        version: IntegerSchema::create(minimum: 0),
                    ),
                    additionalProperties: false,
                    required: ['contentStreamId', 'version'],
                )),
                truncated: BooleanSchema::create(description: 'true if older events were left out: only the newest 100 are listed'),
                events: ArraySchema::create(description: 'Oldest first', items: PendingEvent::schema()),
            ),
            additionalProperties: false,
            required: ['workspaceName', 'baseWorkspaceName', 'status', 'contentStreamId', 'forkedFrom', 'truncated', 'events'],
        );
    }
}
