<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\WorkspaceHistory\Schema;

use Neos\Api\Endpoint\Nodes\Schema\NodeAggregateId;
use Neos\Api\Endpoint\Workspaces\Schema\WorkspaceName;
use Neos\Api\Endpoint\Workspaces\Schema\WorkspaceStatus;
use Neos\JsonSchema\ArraySchema;
use Neos\JsonSchema\BooleanSchema;
use Neos\JsonSchema\Nullable;
use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\StringSchema;
use Neos\JsonSchema\Support\ObjectProperties;

/**
 * What was deleted in a workspace and can be restored
 *
 * The schema is written out: the items are arrays
 */
final readonly class Trash implements ProvidesSchema
{
    /**
     * @param list<array<string, mixed>> $items
     */
    public function __construct(
        public WorkspaceName $workspaceName,
        public WorkspaceStatus $status,
        public array $items,
        public bool $truncated,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'What was deleted in the workspace and not yet published. Deleting only hides a node until the deletion is published, restoreNode of the Neos API brings it back; it needs an up_to_date workspace',
            properties: ObjectProperties::create(
                workspaceName: WorkspaceName::schema(),
                status: WorkspaceStatus::schema(),
                items: ArraySchema::create(
                    description: 'The deleted nodes, newest first',
                    items: ObjectSchema::create(
                        properties: ObjectProperties::create(
                            nodeAggregateId: NodeAggregateId::schema(),
                            nodeAddress: Nullable::wrap(NodeAddress::schema()),
                            label: StringSchema::create(description: 'Its label, else its node type'),
                            nodeType: StringSchema::create(),
                            icon: Nullable::wrap(StringSchema::create()),
                            isDocument: BooleanSchema::create(),
                            breadcrumb: ArraySchema::create(description: 'The labels from the site down to the node itself', items: StringSchema::create()),
                            siteAggregateId: Nullable::wrap(NodeAggregateId::schema()),
                            siteLabel: Nullable::wrap(StringSchema::create()),
                            dimensions: ArraySchema::create(
                                description: 'The dimension space points it is deleted in',
                                items: ObjectSchema::create(additionalProperties: StringSchema::create()),
                            ),
                            deletedAt: Nullable::wrap(StringSchema::create(description: 'As ISO 8601')),
                            deletedBy: Nullable::wrap(StringSchema::create(description: 'The name of who deleted it')),
                            restoresAncestors: ArraySchema::create(
                                description: 'Deleted ancestors restoring brings back as well, it would stay hidden in them otherwise',
                                items: ObjectSchema::create(
                                    properties: ObjectProperties::create(
                                        nodeAggregateId: NodeAggregateId::schema(),
                                        label: Nullable::wrap(StringSchema::create()),
                                    ),
                                    additionalProperties: false,
                                    required: ['nodeAggregateId', 'label'],
                                ),
                            ),
                        ),
                        additionalProperties: false,
                        required: ['nodeAggregateId', 'nodeAddress', 'label', 'nodeType', 'icon', 'isDocument', 'breadcrumb', 'siteAggregateId', 'siteLabel', 'dimensions', 'deletedAt', 'deletedBy', 'restoresAncestors'],
                    ),
                ),
                truncated: BooleanSchema::create(description: 'true if more was deleted than is listed'),
            ),
            additionalProperties: false,
            required: ['workspaceName', 'status', 'items', 'truncated'],
        );
    }
}
