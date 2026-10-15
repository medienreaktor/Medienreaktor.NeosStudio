<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\AccessRoles\Schema;

use Medienreaktor\NeosStudio\Domain\Model;
use Neos\Api\Endpoint\Users\Schema\UserId;
use Neos\JsonSchema\ArraySchema;
use Neos\JsonSchema\BooleanSchema;
use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\StringSchema;
use Neos\JsonSchema\Support\ObjectProperties;

/**
 * An access role: where its members may work in the Neos backend, the Studio
 * and the Neos API
 *
 * The schema is written out for the list of members
 */
final readonly class AccessRole implements ProvidesSchema
{
    /**
     * @param list<string> $memberUserIds
     */
    public function __construct(
        public AccessRoleId $id,
        public string $identifier,
        public string $label,
        public string $description,
        public bool $active,
        public bool $restricting,
        public AccessRoleConstraints $constraints,
        public array $memberUserIds,
        public string $createdAt,
        public string $updatedAt,
    ) {
    }

    /**
     * @param array<int, string> $memberUserIds
     */
    public static function from(Model\AccessRole $role, array $memberUserIds): self
    {
        return new self(
            AccessRoleId::fromString($role->id),
            $role->identifier,
            $role->label,
            $role->description,
            $role->active,
            $role->constraints->isRestricting(),
            AccessRoleConstraints::from($role->constraints),
            array_values($memberUserIds),
            $role->createdAt->format(\DateTimeInterface::ATOM),
            $role->updatedAt->format(\DateTimeInterface::ATOM),
        );
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'An access role: where its members may work',
            properties: ObjectProperties::create(
                id: AccessRoleId::schema(),
                identifier: StringSchema::create(description: 'A readable identifier, unique, made from the label if none was given', examples: ['marketing-editors']),
                label: StringSchema::create(examples: ['Marketing editors']),
                description: StringSchema::create(description: 'May be empty'),
                active: BooleanSchema::create(description: 'An inactive role restricts nobody'),
                restricting: BooleanSchema::create(description: 'Whether the constraints restrict anything at all'),
                constraints: AccessRoleConstraints::schema(),
                memberUserIds: ArraySchema::create(description: 'The Neos users the role applies to', items: UserId::schema()),
                createdAt: StringSchema::create(description: 'As ISO 8601'),
                updatedAt: StringSchema::create(description: 'As ISO 8601'),
            ),
            additionalProperties: false,
            required: ['id', 'identifier', 'label', 'description', 'active', 'restricting', 'constraints', 'memberUserIds', 'createdAt', 'updatedAt'],
        );
    }
}
