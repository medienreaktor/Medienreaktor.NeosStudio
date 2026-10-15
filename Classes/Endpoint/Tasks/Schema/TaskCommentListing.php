<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Tasks\Schema;

use Neos\Api\Shared\Schema\ListingMeta;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * The comments of a task, oldest first, as JSON:API's top level: the items in
 * data, the total in meta. Not paged, so no links
 */
final readonly class TaskCommentListing implements ProvidesSchema
{
    public function __construct(
        public TaskCommentList $data,
        public ListingMeta $meta,
    ) {
    }

    public static function of(TaskCommentList $data): self
    {
        return new self($data, new ListingMeta(count($data->comments)));
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }
}
