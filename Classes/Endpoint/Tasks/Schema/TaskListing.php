<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Tasks\Schema;

use Neos\Api\Shared\Schema\ListingMeta;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * The tasks the caller may see, as JSON:API's top level: the items in data,
 * the total in meta. Not paged, so no links
 */
final readonly class TaskListing implements ProvidesSchema
{
    public function __construct(
        public TaskList $data,
        public ListingMeta $meta,
    ) {
    }

    public static function of(TaskList $data): self
    {
        return new self($data, new ListingMeta(count($data->tasks)));
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }
}
