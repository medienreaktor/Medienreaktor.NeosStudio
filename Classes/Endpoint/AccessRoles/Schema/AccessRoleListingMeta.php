<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\AccessRoles\Schema;

use Neos\JsonSchema\ArraySchema;
use Neos\JsonSchema\BooleanSchema;
use Neos\JsonSchema\IntegerSchema;
use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\StringSchema;
use Neos\JsonSchema\Support\ObjectProperties;

/**
 * What the list of access roles says about itself and the roles beyond its
 * items
 */
final readonly class AccessRoleListingMeta implements ProvidesSchema
{
    /**
     * @param list<string> $bypassRoles
     */
    public function __construct(
        public int $total,
        public AccessCapabilityList $capabilities,
        public array $bypassRoles,
        public bool $enforcedInContentRepository,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'What the list says about itself and the access roles beyond its items',
            properties: ObjectProperties::create(
                total: IntegerSchema::create(description: 'How many access roles there are', minimum: 0),
                capabilities: AccessCapabilityList::schema(),
                bypassRoles: ArraySchema::create(
                    description: 'The Neos roles exempt from access roles (administrators by default): a user holding one can\'t be a member',
                    items: StringSchema::create(examples: ['Neos.Neos:Administrator']),
                ),
                enforcedInContentRepository: BooleanSchema::create(description: 'Whether the content repository refuses changes outside a member\'s roles, else they only shape the user interface'),
            ),
            additionalProperties: false,
            required: ['total', 'capabilities', 'bypassRoles', 'enforcedInContentRepository'],
        );
    }
}
