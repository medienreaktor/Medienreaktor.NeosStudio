<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Tasks\RequestBody;

use Neos\Api\Endpoint\Users\Schema\UserId;
use Neos\Api\Endpoint\Workspaces\Schema\WorkspaceName;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * A new task, the title of its workspace and its name are made from the title
 */
final readonly class TaskCreate implements ProvidesSchema
{
    /**
     * @param string $title what is to be done, not empty
     * @param string|null $description details, empty if omitted
     * @param WorkspaceName|null $baseWorkspaceName the workspace the task's workspace is based on and is published to, live if omitted
     * @param UserId|null $assignee who works on it, nobody if omitted
     */
    public function __construct(
        public string $title,
        public ?string $description = null,
        public ?WorkspaceName $baseWorkspaceName = null,
        public ?UserId $assignee = null,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }
}
