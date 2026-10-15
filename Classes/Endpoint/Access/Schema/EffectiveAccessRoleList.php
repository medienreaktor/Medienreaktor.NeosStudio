<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Access\Schema;

use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * A list of the caller's access roles
 *
 * @implements \IteratorAggregate<EffectiveAccessRole>
 */
final readonly class EffectiveAccessRoleList implements ProvidesSchema, \IteratorAggregate
{
    /**
     * @var list<EffectiveAccessRole>
     */
    public array $roles;

    public function __construct(EffectiveAccessRole ...$roles)
    {
        $this->roles = array_values($roles);
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }

    public function getIterator(): \Traversable
    {
        yield from $this->roles;
    }
}
