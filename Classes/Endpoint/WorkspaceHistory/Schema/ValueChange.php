<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\WorkspaceHistory\Schema;

use Neos\JsonSchema\AnySchema;
use Neos\JsonSchema\Nullable;
use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\StringSchema;
use Neos\JsonSchema\Support\ObjectProperties;

/**
 * One thing that changed about a node, before and after
 *
 * Only describes the change rows of the diffs, which are arrays
 */
final readonly class ValueChange implements ProvidesSchema
{
    private function __construct()
    {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'One thing that changed about a node, before (old) and after (new); null for "didn\'t exist"',
            properties: ObjectProperties::create(
                kind: StringSchema::create(
                    description: 'What changed: a property, a reference, the node type, name, parent, position among its siblings, a subtree tag or a dimension variant',
                    enum: ['property', 'reference', 'nodeType', 'name', 'parent', 'position', 'tag', 'variant'],
                ),
                property: Nullable::wrap(StringSchema::create(description: 'The name of the property or reference, null for the other kinds')),
                label: Nullable::wrap(StringSchema::create(description: 'The label the node type configures for the property or reference, possibly a translation ID')),
                old: AnySchema::create(description: 'The value before: a property in its serialized form, {id, label} of a node (reference, parent), a node type or tag name, dimension values (variant)'),
                new: AnySchema::create(description: 'The value after, as old'),
            ),
            additionalProperties: false,
            required: ['kind', 'property', 'label', 'old', 'new'],
        );
    }
}
