<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Access\Schema;

use Medienreaktor\NeosStudio\Endpoint\AccessRoles\Schema\AccessCapabilityList;
use Neos\Api\Endpoint\Nodes\Schema\NodeAggregateId;
use Neos\JsonSchema\ArraySchema;
use Neos\JsonSchema\BooleanSchema;
use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\StringSchema;
use Neos\JsonSchema\Support\ObjectProperties;

/**
 * Where the caller's access roles let them work
 *
 * The roles come one by one: they add up, each question is answered by OR-ing
 * them, which one merged set of constraints couldn't express (a DENY rule of
 * one role would cut into a branch another role allows). The schema is
 * written out for the list of path anchors
 */
final readonly class MyAccess implements ProvidesSchema
{
    /**
     * @param list<string> $pathAnchors
     */
    public function __construct(
        public bool $unrestricted,
        public string $reason,
        public EffectiveAccessRoleList $roles,
        public array $pathAnchors,
        public AccessCapabilityList $capabilities,
        public bool $canAdminister,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'Where the caller\'s access roles let them work',
            properties: ObjectProperties::create(
                unrestricted: BooleanSchema::create(description: 'true if nothing restricts the caller: an administrator (a role exempt from access control), or a user without an access role'),
                reason: StringSchema::create(description: 'Why the caller is (un)restricted, for display'),
                roles: EffectiveAccessRoleList::schema(),
                pathAnchors: ArraySchema::create(
                    description: 'The ancestors of every document an ALLOW rule opens. They aren\'t allowed themselves, but a page tree shows them so the allowed branches can be reached. Resolved in live, as the page hierarchy changes when pages move',
                    items: NodeAggregateId::schema(),
                ),
                capabilities: AccessCapabilityList::schema(),
                canAdminister: BooleanSchema::create(description: 'Whether the caller may administer the access roles (listAccessRoles and the operations changing them)'),
            ),
            additionalProperties: false,
            required: ['unrestricted', 'reason', 'roles', 'pathAnchors', 'capabilities', 'canAdminister'],
        );
    }
}
