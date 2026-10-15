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
 * What publishing a document of a workspace would change in its base
 * workspace, node by node
 *
 * The schema is written out: the nodes are arrays
 */
final readonly class DocumentDiff implements ProvidesSchema
{
    /**
     * @param list<array<string, mixed>> $nodes
     */
    public function __construct(
        public WorkspaceName $workspaceName,
        public ?WorkspaceName $baseWorkspaceName,
        public NodeAggregateId $documentAggregateId,
        public array $nodes,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'What publishing the document would change in the base workspace',
            properties: ObjectProperties::create(
                workspaceName: WorkspaceName::schema(),
                baseWorkspaceName: Nullable::wrap(WorkspaceName::schema()),
                documentAggregateId: NodeAggregateId::schema(),
                nodes: ArraySchema::create(
                    description: 'The changed nodes of the document, each dimension variant once',
                    items: ObjectSchema::create(
                        properties: ObjectProperties::create(
                            nodeAggregateId: NodeAggregateId::schema(),
                            dimensions: ObjectSchema::create(description: 'The dimension values of the variant', additionalProperties: StringSchema::create()),
                            status: StringSchema::create(
                                description: 'variant for a dimension variant of a node the base workspace has',
                                enum: ['created', 'removed', 'moved', 'changed', 'variant'],
                            ),
                            nodeLabel: Nullable::wrap(StringSchema::create()),
                            nodeType: Nullable::wrap(StringSchema::create()),
                            icon: Nullable::wrap(StringSchema::create()),
                            changes: ArraySchema::create(description: 'Empty for a removed node', items: ValueChange::schema()),
                        ),
                        additionalProperties: false,
                        required: ['nodeAggregateId', 'dimensions', 'status', 'nodeLabel', 'nodeType', 'icon', 'changes'],
                    ),
                ),
            ),
            additionalProperties: false,
            required: ['workspaceName', 'baseWorkspaceName', 'documentAggregateId', 'nodes'],
        );
    }
}
