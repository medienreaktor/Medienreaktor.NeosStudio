<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Tasks\RequestBody;

use Neos\JsonSchema\Nullable;
use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\StringSchema;
use Neos\JsonSchema\Support\ObjectProperties;

/**
 * What to tell the reviewers when submitting a task
 *
 * The schema is written out: schematic would read a class with one string as
 * that string
 */
final readonly class TaskSubmit implements ProvidesSchema
{
    /**
     * @param string|null $comment a comment for the reviewers, added to the task's comments and its notification
     */
    public function __construct(
        public ?string $comment = null,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'What to tell the reviewers',
            properties: ObjectProperties::create(
                comment: Nullable::wrap(StringSchema::create(description: 'A comment for the reviewers, added to the task\'s comments and its notification')),
            ),
            additionalProperties: false,
        );
    }
}
