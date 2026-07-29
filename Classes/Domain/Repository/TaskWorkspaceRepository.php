<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Domain\Repository;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Exception as DbalException;
use Medienreaktor\NeosStudio\Domain\Model\TaskStatus;
use Medienreaktor\NeosStudio\Domain\Model\TaskWorkspace;
use Neos\ContentRepository\Core\SharedModel\ContentRepository\ContentRepositoryId;
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\Model\UserId;

/**
 * Plain DBAL sidecar storage for task metadata, keyed exactly like the Neos
 * core's own workspace metadata table (content repository id + workspace
 * name) - the same layering pattern one level up. No security is imposed
 * here; use the TaskWorkspaceService.
 *
 * @internal
 */
#[Flow\Scope('singleton')]
final readonly class TaskWorkspaceRepository
{
    private const TABLE_NAME = 'medienreaktor_neosstudio_task';

    public function __construct(
        private Connection $dbal,
    ) {
    }

    public function add(ContentRepositoryId $contentRepositoryId, TaskWorkspace $taskWorkspace): void
    {
        try {
            $this->dbal->insert(self::TABLE_NAME, [
                'content_repository_id' => $contentRepositoryId->value,
                'workspace_name' => $taskWorkspace->workspaceName->value,
                'status' => $taskWorkspace->status->value,
                'assignee_user_id' => $taskWorkspace->assigneeUserId?->value,
                'created_by_user_id' => $taskWorkspace->createdByUserId?->value,
                'created_at' => $taskWorkspace->createdAt->format('Y-m-d H:i:s'),
            ]);
        } catch (DbalException $e) {
            throw new \RuntimeException(sprintf('Failed to add task metadata for workspace "%s" (Content Repository "%s"): %s', $taskWorkspace->workspaceName->value, $contentRepositoryId->value, $e->getMessage()), 1753776010, $e);
        }
    }

    public function findByWorkspaceName(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): ?TaskWorkspace
    {
        $table = self::TABLE_NAME;
        $row = $this->dbal->fetchAssociative(
            "SELECT * FROM {$table} WHERE content_repository_id = :contentRepositoryId AND workspace_name = :workspaceName",
            [
                'contentRepositoryId' => $contentRepositoryId->value,
                'workspaceName' => $workspaceName->value,
            ]
        );

        return is_array($row) ? $this->mapRow($row) : null;
    }

    /**
     * All task workspaces of the content repository, keyed by workspace name.
     *
     * @return array<string, TaskWorkspace>
     */
    public function findAll(ContentRepositoryId $contentRepositoryId): array
    {
        $table = self::TABLE_NAME;
        $rows = $this->dbal->fetchAllAssociative(
            "SELECT * FROM {$table} WHERE content_repository_id = :contentRepositoryId ORDER BY created_at DESC",
            ['contentRepositoryId' => $contentRepositoryId->value]
        );

        $tasks = [];
        foreach ($rows as $row) {
            $task = $this->mapRow($row);
            $tasks[$task->workspaceName->value] = $task;
        }

        return $tasks;
    }

    public function updateStatus(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName, TaskStatus $status): void
    {
        $this->dbal->update(self::TABLE_NAME, ['status' => $status->value], [
            'content_repository_id' => $contentRepositoryId->value,
            'workspace_name' => $workspaceName->value,
        ]);
    }

    public function updateAssignee(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName, ?UserId $assigneeUserId): void
    {
        $this->dbal->update(self::TABLE_NAME, ['assignee_user_id' => $assigneeUserId?->value], [
            'content_repository_id' => $contentRepositoryId->value,
            'workspace_name' => $workspaceName->value,
        ]);
    }

    public function remove(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): void
    {
        $this->dbal->delete(self::TABLE_NAME, [
            'content_repository_id' => $contentRepositoryId->value,
            'workspace_name' => $workspaceName->value,
        ]);
    }

    /**
     * @param array<string, mixed> $row
     */
    private function mapRow(array $row): TaskWorkspace
    {
        return new TaskWorkspace(
            WorkspaceName::fromString($row['workspace_name']),
            TaskStatus::from($row['status']),
            $row['assignee_user_id'] !== null ? UserId::fromString($row['assignee_user_id']) : null,
            $row['created_by_user_id'] !== null ? UserId::fromString($row['created_by_user_id']) : null,
            new \DateTimeImmutable($row['created_at']),
        );
    }
}
