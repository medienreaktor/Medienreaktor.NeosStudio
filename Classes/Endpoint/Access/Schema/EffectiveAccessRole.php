<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Access\Schema;

use Medienreaktor\NeosStudio\Domain\Model;
use Medienreaktor\NeosStudio\Endpoint\AccessRoles\Schema\AccessRoleConstraints;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * An access role of the caller: what it allows, without its members
 */
final readonly class EffectiveAccessRole implements ProvidesSchema
{
    /**
     * @param string $id the ID of the access role
     * @param string $identifier its readable identifier
     */
    public function __construct(
        public string $id,
        public string $identifier,
        public string $label,
        public AccessRoleConstraints $constraints,
    ) {
    }

    public static function from(Model\AccessRole $role): self
    {
        return new self($role->id, $role->identifier, $role->label, AccessRoleConstraints::from($role->constraints));
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }
}
