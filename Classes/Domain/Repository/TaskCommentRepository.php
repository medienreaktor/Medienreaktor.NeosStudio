<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Domain\Repository;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Exception as DbalException;
use Medienreaktor\NeosStudio\Domain\Model\TaskComment;
use Neos\ContentRepository\Core\SharedModel\ContentRepository\ContentRepositoryId;
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\Model\UserId;

/**
 * Plain DBAL storage for task workspace comments, keyed like the task
 * sidecar (content repository id + workspace name). No security is imposed
 * here; use the TaskWorkspaceService.
 *
 * @internal
 */
#[Flow\Scope('singleton')]
final readonly class TaskCommentRepository
{
    private const TABLE_NAME = 'medienreaktor_neosstudio_task_comment';

    public function __construct(
        private Connection $dbal,
    ) {
    }

    public function add(ContentRepositoryId $contentRepositoryId, TaskComment $comment): TaskComment
    {
        try {
            $this->dbal->insert(self::TABLE_NAME, [
                'content_repository_id' => $contentRepositoryId->value,
                'workspace_name' => $comment->workspaceName->value,
                'author_user_id' => $comment->authorUserId?->value,
                'text' => $comment->text,
                'created_at' => $comment->createdAt->format('Y-m-d H:i:s'),
            ]);
        } catch (DbalException $e) {
            throw new \RuntimeException(sprintf('Failed to add a comment on task workspace "%s" (Content Repository "%s"): %s', $comment->workspaceName->value, $contentRepositoryId->value, $e->getMessage()), 1753776030, $e);
        }

        return new TaskComment(
            (int)$this->dbal->lastInsertId(),
            $comment->workspaceName,
            $comment->authorUserId,
            $comment->text,
            $comment->createdAt,
        );
    }

    /**
     * The workspace's comments, oldest first (a conversation reads top-down).
     *
     * @return array<TaskComment>
     */
    public function findByWorkspaceName(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): array
    {
        $table = self::TABLE_NAME;
        $rows = $this->dbal->fetchAllAssociative(
            "SELECT * FROM {$table} WHERE content_repository_id = :contentRepositoryId AND workspace_name = :workspaceName ORDER BY created_at ASC, id ASC",
            [
                'contentRepositoryId' => $contentRepositoryId->value,
                'workspaceName' => $workspaceName->value,
            ]
        );

        return array_map($this->mapRow(...), $rows);
    }

    public function removeForWorkspace(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): void
    {
        $this->dbal->delete(self::TABLE_NAME, [
            'content_repository_id' => $contentRepositoryId->value,
            'workspace_name' => $workspaceName->value,
        ]);
    }

    /**
     * @param array<string, mixed> $row
     */
    private function mapRow(array $row): TaskComment
    {
        return new TaskComment(
            (int)$row['id'],
            WorkspaceName::fromString($row['workspace_name']),
            $row['author_user_id'] !== null ? UserId::fromString($row['author_user_id']) : null,
            $row['text'],
            new \DateTimeImmutable($row['created_at']),
        );
    }
}
