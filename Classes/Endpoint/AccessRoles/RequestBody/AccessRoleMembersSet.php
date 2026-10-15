<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\AccessRoles\RequestBody;

use Neos\Api\Endpoint\Users\Schema\UserId;
use Neos\JsonSchema\ArraySchema;
use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\Support\ObjectProperties;

/**
 * The members of an access role as a whole
 */
final readonly class AccessRoleMembersSet implements ProvidesSchema
{
    /**
     * @param list<string> $userIds
     */
    public function __construct(
        public array $userIds,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'The members of the access role, replacing the ones it has',
            properties: ObjectProperties::create(
                userIds: ArraySchema::create(description: 'The Neos users the role applies to, empty for nobody', items: UserId::schema()),
            ),
            additionalProperties: false,
            required: ['userIds'],
        );
    }
}
