<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Tasks\RequestBody;

use Neos\Api\Endpoint\Users\Schema\UserId;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * Who works on a task from now on
 */
final readonly class TaskAssigneeChange implements ProvidesSchema
{
    /**
     * @param UserId|null $assignee the user, null for nobody
     */
    public function __construct(
        public ?UserId $assignee = null,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }
}
