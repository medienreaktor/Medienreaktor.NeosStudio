<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\WorkspaceHistory\Schema;

use Neos\Api\Endpoint\Nodes\Schema\NodeAggregateId;
use Neos\Api\Endpoint\Workspaces\Schema\SequenceNumber;
use Neos\JsonSchema\ArraySchema;
use Neos\JsonSchema\IntegerSchema;
use Neos\JsonSchema\Nullable;
use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\StringSchema;
use Neos\JsonSchema\Support\ObjectProperties;

/**
 * An event of a workspace's content stream, for display
 *
 * Only describes the events of the history, which are arrays
 */
final readonly class PendingEvent implements ProvidesSchema
{
    private function __construct()
    {
    }

    public static function properties(): ObjectProperties
    {
        return ObjectProperties::create(
            sequenceNumber: SequenceNumber::schema(),
            version: IntegerSchema::create(description: 'The position of the event in its content stream, from 0: comparable with forkedFrom.version', minimum: 0),
            type: StringSchema::create(description: 'The short name of the event class', examples: ['NodePropertiesWereSet']),
            kind: StringSchema::create(description: 'content: the rendered node changed, structure: the tree changed', enum: ['content', 'structure']),
            nodeAggregateId: Nullable::wrap(NodeAggregateId::schema()),
            parentNodeAggregateId: Nullable::wrap(NodeAggregateId::schema()),
            dimensionSpacePoints: ArraySchema::create(
                description: 'The dimension space points it affects, empty for all',
                items: ObjectSchema::create(additionalProperties: StringSchema::create()),
            ),
            tag: Nullable::wrap(StringSchema::create(description: 'The subtree tag of SubtreeWasTagged/-Untagged: removed for a deletion, disabled for hiding')),
            initiatingUserId: Nullable::wrap(StringSchema::create(description: 'The Neos user who caused it')),
            initiatingUserLabel: Nullable::wrap(StringSchema::create(description: 'Their name')),
            recordedAt: StringSchema::create(description: 'As ISO 8601'),
            nodeLabel: Nullable::wrap(StringSchema::create(description: 'The label of the node, null if it is gone')),
            nodeType: Nullable::wrap(StringSchema::create()),
            icon: Nullable::wrap(StringSchema::create(description: 'The icon the node type configures')),
            command: Nullable::wrap(StringSchema::create(description: 'The short name of the command that caused it', examples: ['SetSerializedNodeProperties'])),
            initiatingTimestamp: Nullable::wrap(StringSchema::create(description: 'When the command was issued: with the user, the events of one editing step share it')),
            documentAggregateId: Nullable::wrap(NodeAggregateId::schema()),
            documentLabel: Nullable::wrap(StringSchema::create(description: 'The label of the closest document')),
            documentAddress: Nullable::wrap(NodeAddress::schema()),
        );
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'An event of the workspace\'s content stream, with the node, document and user it is about',
            properties: self::properties(),
            additionalProperties: false,
            required: self::properties()->names(),
        );
    }
}
