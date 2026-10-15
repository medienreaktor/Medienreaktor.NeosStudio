<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Tasks\Schema;

use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * A list of task comments
 *
 * @implements \IteratorAggregate<TaskComment>
 */
final readonly class TaskCommentList implements ProvidesSchema, \IteratorAggregate
{
    /**
     * @var list<TaskComment>
     */
    public array $comments;

    public function __construct(TaskComment ...$comments)
    {
        $this->comments = array_values($comments);
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }

    public function getIterator(): \Traversable
    {
        yield from $this->comments;
    }
}
