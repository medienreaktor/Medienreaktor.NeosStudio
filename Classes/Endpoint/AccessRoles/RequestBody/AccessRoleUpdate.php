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
 * Changes to an access role: what is left out stays as it is
 *
 * Only describes and validates the body, the operation reads it itself: the
 * constraints hold maps, which schematic can't build
 */
final readonly class AccessRoleUpdate implements ProvidesSchema
{
    private function __construct()
    {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'Changes to an access role, what is left out stays as it is. constraints and memberUserIds replace the whole set',
            examples: [['active' => false]],
            properties: ObjectProperties::create(
                label: StringSchema::create(description: 'Not empty', minLength: 1),
                description: StringSchema::create(),
                constraints: AccessRoleConstraints::schema(),
                memberUserIds: ArraySchema::create(description: 'The Neos users the role applies to', items: UserId::schema()),
                active: BooleanSchema::create(description: 'An inactive role restricts nobody'),
            ),
            additionalProperties: false,
        );
    }
}
