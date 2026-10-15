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
 * Why a task goes back into work
 *
 * The schema is written out: schematic would read a class with one string as
 * that string
 */
final readonly class TaskReopen implements ProvidesSchema
{
    /**
     * @param string|null $reason why, e.g. what the review found, for the notification of the assignee and the creator
     */
    public function __construct(
        public ?string $reason = null,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'Why the task goes back into work',
            properties: ObjectProperties::create(
                reason: Nullable::wrap(StringSchema::create(description: 'Why, e.g. what the review found, for the notification of the assignee and the creator')),
            ),
            additionalProperties: false,
        );
    }
}
