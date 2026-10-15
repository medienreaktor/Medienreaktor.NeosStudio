<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\PreviewLinks\Schema;

use Neos\Api\Shared\Schema\ListingMeta;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * The caller's active preview links, as JSON:API's top level: the items in
 * data, the total in meta. Not paged, so no links
 */
final readonly class PreviewLinkListing implements ProvidesSchema
{
    public function __construct(
        public PreviewLinkList $data,
        public ListingMeta $meta,
    ) {
    }

    public static function of(PreviewLinkList $data): self
    {
        return new self($data, new ListingMeta(count($data->previewLinks)));
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }
}
