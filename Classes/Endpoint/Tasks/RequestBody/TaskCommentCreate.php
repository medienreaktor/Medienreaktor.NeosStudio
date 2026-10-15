<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Tasks\RequestBody;

use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\StringSchema;
use Neos\JsonSchema\Support\ObjectProperties;

/**
 * A new comment on a task
 *
 * The schema is written out: schematic would read a class with one string as
 * that string
 */
final readonly class TaskCommentCreate implements ProvidesSchema
{
    /**
     * @param string $text the comment, not empty
     */
    public function __construct(
        public string $text,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'A new comment on the task',
            properties: ObjectProperties::create(
                text: StringSchema::create(description: 'The comment, not empty'),
            ),
            additionalProperties: false,
            required: ['text'],
        );
    }
}
