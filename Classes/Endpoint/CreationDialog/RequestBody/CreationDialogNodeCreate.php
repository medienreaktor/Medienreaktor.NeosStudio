<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\CreationDialog\RequestBody;

use Neos\Api\Endpoint\Nodes\RequestBody\NodeCreate;
use Neos\Api\Endpoint\Nodes\Schema\NodeAggregateId;
use Neos\Api\Endpoint\NodeTypes\Schema\NodeTypeName;
use Neos\JsonSchema\Nullable;
use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\Support\ObjectProperties;

/**
 * A node to create below a parent, as Neos.Api's NodeCreate, with the values of its creation dialog
 *
 * The schema is written out: properties, references and elements are maps, which schematic can't discover
 */
final readonly class CreationDialogNodeCreate implements ProvidesSchema
{
    /**
     * @param array<string, mixed> $properties
     * @param array<string, mixed> $references
     * @param array<string, mixed> $elements
     */
    public function __construct(
        public NodeTypeName $nodeType,
        public NodeAggregateId $parentNodeAggregateId,
        public NodeAggregateId|null $succeedingSiblingNodeAggregateId = null,
        public NodeAggregateId|null $nodeAggregateId = null,
        public array $properties = [],
        public array $references = [],
        public array $elements = [],
    ) {
    }

    /**
     * The node to create without the creation dialog, as Neos.Api's createNode takes it
     */
    public function toNodeCreate(): NodeCreate
    {
        return new NodeCreate($this->nodeType, $this->parentNodeAggregateId, $this->succeedingSiblingNodeAggregateId, $this->nodeAggregateId, $this->properties, $this->references);
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'A node to create below a parent, with the values of its creation dialog',
            properties: ObjectProperties::create(
                nodeType: NodeTypeName::schema(),
                parentNodeAggregateId: NodeAggregateId::schema(),
                succeedingSiblingNodeAggregateId: Nullable::wrap(NodeAggregateId::schema()),
                nodeAggregateId: Nullable::wrap(NodeAggregateId::schema()),
                properties: ObjectSchema::create(
                    description: 'The properties to set, as for createNode. They win over what the node creation handlers set',
                    examples: [['title' => 'About us']],
                    additionalProperties: true,
                ),
                references: ObjectSchema::create(
                    description: 'The references to set, as for createNode. They win over what the node creation handlers set',
                    examples: [['relatedPages' => [['nodeAggregateId' => 'a3474e1d-dd60-4a84-82b1-18d2f21891a3']]]],
                    additionalProperties: true,
                ),
                elements: ObjectSchema::create(
                    description: 'The values of the node type\'s creation dialog (ui.creationDialog.elements, with the properties and references it promotes) by element name, for its node creation handlers as the Neos UI\'s creation dialog sends them: a reference(s) element as a node aggregate id or a list of them, one named like a property as that property, dates as RFC 3339, assets as {"id": "…"}',
                    examples: [['title' => 'About us']],
                    additionalProperties: true,
                ),
            ),
            additionalProperties: false,
            required: ['nodeType', 'parentNodeAggregateId'],
        );
    }
}
