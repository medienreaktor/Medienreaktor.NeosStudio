<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Tasks\Schema;

use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * A list of tasks
 *
 * @implements \IteratorAggregate<Task>
 */
final readonly class TaskList implements ProvidesSchema, \IteratorAggregate
{
    /**
     * @var list<Task>
     */
    public array $tasks;

    public function __construct(Task ...$tasks)
    {
        $this->tasks = array_values($tasks);
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }

    public function getIterator(): \Traversable
    {
        yield from $this->tasks;
    }
}
