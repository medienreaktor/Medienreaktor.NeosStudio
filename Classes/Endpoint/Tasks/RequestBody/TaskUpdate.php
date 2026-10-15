<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Tasks\RequestBody;

use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * Changes to a task: what is left out or null stays as it is
 */
final readonly class TaskUpdate implements ProvidesSchema
{
    /**
     * @param string|null $title what is to be done, not empty
     * @param string|null $description details, may be empty
     */
    public function __construct(
        public ?string $title = null,
        public ?string $description = null,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }
}
