<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Notifications\Schema;

use Neos\Api\Shared\Schema\ListingLinks;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * A page of the caller's notifications, as JSON:API's top level: the items in
 * data, the totals in meta, the other pages in links
 */
final readonly class PaginatedNotificationListing implements ProvidesSchema
{
    public function __construct(
        public NotificationList $data,
        public NotificationListingMeta $meta,
        public ListingLinks $links,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }
}
