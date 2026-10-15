<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Tasks\Schema;

use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\StringSchema;

/**
 * Where a task is in its workflow, the values of
 * Medienreaktor\NeosStudio\Domain\Model\TaskStatus
 */
enum TaskStatus: string implements ProvidesSchema
{
    case OPEN = 'OPEN';
    case IN_REVIEW = 'IN_REVIEW';
    case DONE = 'DONE';

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= StringSchema::create(
            description: 'OPEN while it is worked on, IN_REVIEW once submitted to the reviewers, DONE once approved or its workspace was published',
            enum: array_map(static fn (self $case) => $case->value, self::cases()),
        );
    }
}
