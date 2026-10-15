<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\WorkspaceHistory\Schema;

use Neos\Api\Endpoint\Nodes\Schema\NodeAggregateId;
use Neos\Api\Endpoint\Workspaces\Schema\WorkspaceName;
use Neos\JsonSchema\ArraySchema;
use Neos\JsonSchema\Nullable;
use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\StringSchema;
use Neos\JsonSchema\Support\ObjectProperties;

/**
 * The nodes of a conflict, which the Neos API names by ID only, with their
 * labels and documents
 *
 * The schema is written out: the nodes are arrays
 */
final readonly class ConflictingNodes implements ProvidesSchema
{
    /**
     * @param list<array<string, mixed>> $nodes
     */
    public function __construct(
        public WorkspaceName $workspaceName,
        public array $nodes,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'The nodes of a conflict with their labels and documents',
            properties: ObjectProperties::create(
                workspaceName: WorkspaceName::schema(),
                nodes: ArraySchema::create(
                    description: 'In the order asked for. Labels are null for a node that can\'t be found',
                    items: ObjectSchema::create(
                        properties: ObjectProperties::create(
                            nodeAggregateId: NodeAggregateId::schema(),
                            nodeLabel: Nullable::wrap(StringSchema::create()),
                            documentAggregateId: Nullable::wrap(NodeAggregateId::schema()),
                            documentLabel: Nullable::wrap(StringSchema::create()),
                            documentAddress: Nullable::wrap(NodeAddress::schema()),
                        ),
                        additionalProperties: false,
                        required: ['nodeAggregateId', 'nodeLabel', 'documentAggregateId', 'documentLabel', 'documentAddress'],
                    ),
                ),
            ),
            additionalProperties: false,
            required: ['workspaceName', 'nodes'],
        );
    }
}
