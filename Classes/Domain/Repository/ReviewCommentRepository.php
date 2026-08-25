<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Domain\Repository;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Exception as DbalException;
use Medienreaktor\NeosStudio\Domain\Model\ReviewComment;
use Medienreaktor\NeosStudio\Domain\Model\ReviewCommentAnchor;
use Neos\ContentRepository\Core\DimensionSpace\DimensionSpacePoint;
use Neos\ContentRepository\Core\SharedModel\ContentRepository\ContentRepositoryId;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAggregateId;
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\Model\UserId;

/**
 * Plain DBAL storage for review comments, keyed like the task sidecar
 * (content repository id + workspace name). No security is imposed here; use
 * the ReviewCommentService.
 *
 * @internal
 */
#[Flow\Scope('singleton')]
final readonly class ReviewCommentRepository
{
    private const TABLE_NAME = 'medienreaktor_neosstudio_comment';

    public function __construct(
        private Connection $dbal,
    ) {
    }

    public function add(ContentRepositoryId $contentRepositoryId, ReviewComment $comment): ReviewComment
    {
        try {
            $this->dbal->insert(self::TABLE_NAME, [
                'content_repository_id' => $contentRepositoryId->value,
                'workspace_name' => $comment->workspaceName->value,
                'author_user_id' => $comment->authorUserId?->value,
                'text' => $comment->text,
                'created_at' => $comment->createdAt->format('Y-m-d H:i:s'),
                'document_aggregate_id' => $comment->anchor?->documentAggregateId->value,
                'node_aggregate_id' => $comment->anchor?->nodeAggregateId->value,
                'dimension_space_point_hash' => $comment->anchor?->dimensionSpacePoint->hash,
                'dimension_space_point' => $comment->anchor !== null
                    ? json_encode($comment->anchor->dimensionSpacePoint->coordinates, JSON_THROW_ON_ERROR)
                    : null,
            ]);
        } catch (DbalException | \JsonException $e) {
            throw new \RuntimeException(sprintf('Failed to add a comment on workspace "%s" (Content Repository "%s"): %s', $comment->workspaceName->value, $contentRepositoryId->value, $e->getMessage()), 1753776030, $e);
        }

        return new ReviewComment(
            (int)$this->dbal->lastInsertId(),
            $comment->workspaceName,
            $comment->authorUserId,
            $comment->text,
            $comment->createdAt,
            $comment->anchor,
        );
    }

    public function findById(ContentRepositoryId $contentRepositoryId, int $id): ?ReviewComment
    {
        $table = self::TABLE_NAME;
        $row = $this->dbal->fetchAssociative(
            "SELECT * FROM {$table} WHERE content_repository_id = :contentRepositoryId AND id = :id",
            [
                'contentRepositoryId' => $contentRepositoryId->value,
                'id' => $id,
            ]
        );

        return $row === false ? null : $this->mapRow($row);
    }

    /**
     * The workspace's comments, oldest first (a conversation reads top-down).
     * Anchored and general ones together: the client shows one thread per
     * change and one for the workspace, and fetching them separately would
     * mean a request per change.
     *
     * @return array<ReviewComment>
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

    /**
     * Comment counts of all workspaces at once (for the task listing), keyed
     * by workspace name. Workspaces without comments are absent.
     *
     * @return array<string, int>
     */
    public function countsByWorkspaceName(ContentRepositoryId $contentRepositoryId): array
    {
        $table = self::TABLE_NAME;
        $counts = $this->dbal->fetchAllKeyValue(
            "SELECT workspace_name, COUNT(*) FROM {$table} WHERE content_repository_id = :contentRepositoryId GROUP BY workspace_name",
            ['contentRepositoryId' => $contentRepositoryId->value]
        );

        return array_map(intval(...), $counts);
    }

    public function countForWorkspaceName(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): int
    {
        $table = self::TABLE_NAME;

        return (int)$this->dbal->fetchOne(
            "SELECT COUNT(*) FROM {$table} WHERE content_repository_id = :contentRepositoryId AND workspace_name = :workspaceName",
            [
                'contentRepositoryId' => $contentRepositoryId->value,
                'workspaceName' => $workspaceName->value,
            ]
        );
    }

    public function setResolved(ContentRepositoryId $contentRepositoryId, int $id, ?UserId $resolvedByUserId, ?\DateTimeImmutable $resolvedAt): void
    {
        $this->dbal->update(
            self::TABLE_NAME,
            [
                'resolved_at' => $resolvedAt?->format('Y-m-d H:i:s'),
                'resolved_by_user_id' => $resolvedAt === null ? null : $resolvedByUserId?->value,
            ],
            [
                'content_repository_id' => $contentRepositoryId->value,
                'id' => $id,
            ]
        );
    }

    public function remove(ContentRepositoryId $contentRepositoryId, int $id): void
    {
        $this->dbal->delete(self::TABLE_NAME, [
            'content_repository_id' => $contentRepositoryId->value,
            'id' => $id,
        ]);
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
    private function mapRow(array $row): ReviewComment
    {
        return new ReviewComment(
            (int)$row['id'],
            WorkspaceName::fromString($row['workspace_name']),
            $row['author_user_id'] !== null ? UserId::fromString($row['author_user_id']) : null,
            $row['text'],
            new \DateTimeImmutable($row['created_at']),
            $this->mapAnchor($row),
            $row['resolved_at'] !== null ? new \DateTimeImmutable($row['resolved_at']) : null,
            $row['resolved_by_user_id'] !== null ? UserId::fromString($row['resolved_by_user_id']) : null,
        );
    }

    /**
     * @param array<string, mixed> $row
     */
    private function mapAnchor(array $row): ?ReviewCommentAnchor
    {
        // A comment written before the anchor columns existed, or one on the
        // general thread: both read as "not pinned to anything".
        if (($row['node_aggregate_id'] ?? null) === null || ($row['document_aggregate_id'] ?? null) === null) {
            return null;
        }

        try {
            $coordinates = json_decode((string)$row['dimension_space_point'], true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }

        return new ReviewCommentAnchor(
            NodeAggregateId::fromString($row['document_aggregate_id']),
            NodeAggregateId::fromString($row['node_aggregate_id']),
            DimensionSpacePoint::fromArray(is_array($coordinates) ? $coordinates : []),
        );
    }
}
