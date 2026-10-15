<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\AccessRoles\Schema;

use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * A list of access roles
 *
 * @implements \IteratorAggregate<AccessRole>
 */
final readonly class AccessRoleList implements ProvidesSchema, \IteratorAggregate
{
    /**
     * @var list<AccessRole>
     */
    public array $accessRoles;

    public function __construct(AccessRole ...$accessRoles)
    {
        $this->accessRoles = array_values($accessRoles);
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }

    public function getIterator(): \Traversable
    {
        yield from $this->accessRoles;
    }
}
