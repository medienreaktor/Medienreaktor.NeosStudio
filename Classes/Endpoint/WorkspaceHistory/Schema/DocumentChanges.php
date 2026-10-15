<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\WorkspaceHistory\Schema;

use Neos\Api\Endpoint\Nodes\Schema\NodeAggregateId;
use Neos\Api\Endpoint\Workspaces\Schema\WorkspaceName;
use Neos\Api\Endpoint\Workspaces\Schema\WorkspaceStatus;
use Neos\JsonSchema\ArraySchema;
use Neos\JsonSchema\BooleanSchema;
use Neos\JsonSchema\IntegerSchema;
use Neos\JsonSchema\Nullable;
use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\StringSchema;
use Neos\JsonSchema\Support\ObjectProperties;

/**
 * The changes of a workspace by the document they are in, for reviewing them
 *
 * The schema is written out: the documents are arrays
 */
final readonly class DocumentChanges implements ProvidesSchema
{
    /**
     * @param list<array<string, mixed>> $documents
     */
    public function __construct(
        public WorkspaceName $workspaceName,
        public ?WorkspaceName $baseWorkspaceName,
        public WorkspaceStatus $status,
        public array $documents,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'The changes of a workspace by the document they are in',
            properties: ObjectProperties::create(
                workspaceName: WorkspaceName::schema(),
                baseWorkspaceName: Nullable::wrap(WorkspaceName::schema()),
                status: WorkspaceStatus::schema(),
                documents: ArraySchema::create(
                    description: 'The documents with changes, in the order of their first change. publishWorkspace and discardWorkspace of the Neos API take their IDs',
                    items: ObjectSchema::create(
                        properties: ObjectProperties::create(
                            documentAggregateId: NodeAggregateId::schema(),
                            documentAddress: Nullable::wrap(NodeAddress::schema()),
                            siteAggregateId: Nullable::wrap(NodeAggregateId::schema()),
                            siteLabel: Nullable::wrap(StringSchema::create()),
                            label: StringSchema::create(),
                            nodeType: StringSchema::create(),
                            icon: Nullable::wrap(StringSchema::create(description: 'The icon the node type configures')),
                            breadcrumb: ArraySchema::create(description: 'The labels of the documents from the site down to this one', items: StringSchema::create()),
                            hidden: BooleanSchema::create(),
                            created: BooleanSchema::create(description: 'The document was created'),
                            changed: BooleanSchema::create(description: 'The document or content in it changed'),
                            moved: BooleanSchema::create(description: 'The document was moved'),
                            deleted: BooleanSchema::create(description: 'The document was deleted'),
                            changeCount: IntegerSchema::create(description: 'How many nodes in it changed', minimum: 1),
                        ),
                        additionalProperties: false,
                        required: ['documentAggregateId', 'documentAddress', 'siteAggregateId', 'siteLabel', 'label', 'nodeType', 'icon', 'breadcrumb', 'hidden', 'created', 'changed', 'moved', 'deleted', 'changeCount'],
                    ),
                ),
            ),
            additionalProperties: false,
            required: ['workspaceName', 'baseWorkspaceName', 'status', 'documents'],
        );
    }
}
