<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Tasks\Schema;

use Medienreaktor\NeosStudio\Domain\Model;
use Neos\Api\Endpoint\Users\Schema\UserId;
use Neos\Api\Endpoint\Workspaces\Schema\Workspace;
use Neos\Api\Endpoint\Workspaces\Schema\WorkspaceName;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * A task: a shared workspace to make a change in (its branch), with who works
 * on it and where it is in the review workflow
 *
 * The workspace is the task's ID. Its creator and the reviewers manage it, the
 * assignee works in it, others don't see it
 */
final readonly class Task implements ProvidesSchema
{
    /**
     * @param UserId|null $assignee who works on it, null if nobody is assigned
     * @param UserId|null $createdBy who created it, null if that user is gone
     * @param string $createdAt when it was created, as ISO 8601
     * @param int $commentCount how many comments it has
     * @param Workspace|null $workspace its workspace as getWorkspace of the Neos API has it, null if it was just removed
     * @param bool $canPublish whether the caller may publish its workspace, i.e. write to the base workspace
     */
    public function __construct(
        public WorkspaceName $workspaceName,
        public TaskStatus $status,
        public UserId|null $assignee,
        public UserId|null $createdBy,
        public string $createdAt,
        public int $commentCount,
        public Workspace|null $workspace,
        public bool $canPublish,
    ) {
    }

    public static function from(Model\TaskWorkspace $task, int $commentCount, ?Workspace $workspace, bool $canPublish): self
    {
        return new self(
            WorkspaceName::fromString($task->workspaceName->value),
            TaskStatus::from($task->status->value),
            $task->assigneeUserId !== null ? UserId::fromString($task->assigneeUserId->value) : null,
            $task->createdByUserId !== null ? UserId::fromString($task->createdByUserId->value) : null,
            $task->createdAt->format(\DateTimeInterface::ATOM),
            $commentCount,
            $workspace,
            $canPublish,
        );
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }
}
