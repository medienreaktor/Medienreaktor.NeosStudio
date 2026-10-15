<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\AccessRoles\Schema;

use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * All access roles, as JSON:API's top level: the items in data, the total and
 * what applies to all roles in meta. Not paged, so no links
 */
final readonly class AccessRoleListing implements ProvidesSchema
{
    public function __construct(
        public AccessRoleList $data,
        public AccessRoleListingMeta $meta,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }
}
