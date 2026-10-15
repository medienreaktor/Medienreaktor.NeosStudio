<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Notifications\Schema;

use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * What the notifications list says about itself beyond its items
 */
final readonly class NotificationListingMeta implements ProvidesSchema
{
    /**
     * @param int $total how many items there are on all pages
     * @param int $unread how many of all the caller's notifications are unread, whatever the filter
     */
    public function __construct(
        public int $total,
        public int $unread,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }
}
