<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\AccessRoles\RequestBody;

use Medienreaktor\NeosStudio\Endpoint\AccessRoles\Schema\AccessRoleConstraints;
use Neos\Api\Endpoint\Users\Schema\UserId;
use Neos\JsonSchema\ArraySchema;
use Neos\JsonSchema\BooleanSchema;
use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\StringSchema;
use Neos\JsonSchema\Support\ObjectProperties;

/**
 * A new access role
 *
 * Only describes and validates the body, the operation reads it itself: the
 * constraints hold maps, which schematic can't build
 */
final readonly class AccessRoleCreate implements ProvidesSchema
{
    private function __construct()
    {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'A new access role. Without constraints it restricts nothing',
            examples: [['label' => 'Marketing editors', 'memberUserIds' => ['0fd65ee4-9e85-4b4a-9f2c-4b7b2f3b9e44']]],
            properties: ObjectProperties::create(
                label: StringSchema::create(description: 'Not empty', minLength: 1),
                description: StringSchema::create(description: 'Empty if omitted'),
                identifier: StringSchema::create(description: 'A readable identifier, unique, made from the label if omitted'),
                constraints: AccessRoleConstraints::schema(),
                memberUserIds: ArraySchema::create(description: 'The Neos users the role applies to, none if omitted', items: UserId::schema()),
                active: BooleanSchema::create(description: 'true if omitted'),
            ),
            additionalProperties: false,
            required: ['label'],
        );
    }
}
