<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Domain\Repository;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Exception as DbalException;
use Medienreaktor\NeosStudio\Domain\Model\PreviewLink;
use Neos\ContentRepository\Core\DimensionSpace\DimensionSpacePoint;
use Neos\ContentRepository\Core\SharedModel\ContentRepository\ContentRepositoryId;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAggregateId;
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\Model\UserId;

/**
 * Plain DBAL storage for preview links (same layering as the task sidecar
 * table). No security is imposed here: token validation, expiry and
 * ownership checks live in the PreviewLinkService.
 *
 * @internal
 */
#[Flow\Scope('singleton')]
final readonly class PreviewLinkRepository
{
    private const TABLE_NAME = 'medienreaktor_neosstudio_previewlink';

    public function __construct(
        private Connection $dbal,
    ) {
    }

    public function add(PreviewLink $link): void
    {
        try {
            $this->dbal->insert(self::TABLE_NAME, [
                'id' => $link->id,
                'token_hash' => $link->tokenHash,
                'content_repository_id' => $link->contentRepositoryId->value,
                'workspace_name' => $link->workspaceName->value,
                'dimension_space_point' => $link->dimensionSpacePoint->toJson(),
                'node_aggregate_id' => $link->nodeAggregateId->value,
                'label' => $link->label,
                'created_by_user_id' => $link->createdByUserId->value,
                'created_at' => $link->createdAt->format('Y-m-d H:i:s'),
                'expires_at' => $link->expiresAt->format('Y-m-d H:i:s'),
            ]);
        } catch (DbalException $e) {
            throw new \RuntimeException(sprintf('Failed to add preview link for node "%s": %s', $link->nodeAggregateId->value, $e->getMessage()), 1754380001, $e);
        }
    }

    public function findByTokenHash(string $tokenHash): ?PreviewLink
    {
        $table = self::TABLE_NAME;
        $row = $this->dbal->fetchAssociative(
            "SELECT * FROM {$table} WHERE token_hash = :tokenHash",
            ['tokenHash' => $tokenHash]
        );

        return is_array($row) ? $this->mapRow($row) : null;
    }

    public function findById(string $id): ?PreviewLink
    {
        $table = self::TABLE_NAME;
        $row = $this->dbal->fetchAssociative(
            "SELECT * FROM {$table} WHERE id = :id",
            ['id' => $id]
        );

        return is_array($row) ? $this->mapRow($row) : null;
    }

    /**
     * The creator's links, soonest-expiring last (newest activity on top).
     *
     * @return array<PreviewLink>
     */
    public function findByCreator(UserId $userId): array
    {
        $table = self::TABLE_NAME;
        $rows = $this->dbal->fetchAllAssociative(
            "SELECT * FROM {$table} WHERE created_by_user_id = :userId ORDER BY created_at DESC",
            ['userId' => $userId->value]
        );

        return array_map($this->mapRow(...), $rows);
    }

    public function remove(string $id): void
    {
        $this->dbal->delete(self::TABLE_NAME, ['id' => $id]);
    }

    /** Garbage-collect expired links; called opportunistically on writes. */
    public function removeExpired(\DateTimeImmutable $now): int
    {
        $table = self::TABLE_NAME;

        return (int)$this->dbal->executeStatement(
            "DELETE FROM {$table} WHERE expires_at <= :now",
            ['now' => $now->format('Y-m-d H:i:s')]
        );
    }

    /**
     * @param array<string, mixed> $row
     */
    private function mapRow(array $row): PreviewLink
    {
        return new PreviewLink(
            $row['id'],
            $row['token_hash'],
            ContentRepositoryId::fromString($row['content_repository_id']),
            WorkspaceName::fromString($row['workspace_name']),
            DimensionSpacePoint::fromJsonString($row['dimension_space_point']),
            NodeAggregateId::fromString($row['node_aggregate_id']),
            $row['label'],
            UserId::fromString($row['created_by_user_id']),
            new \DateTimeImmutable($row['created_at']),
            new \DateTimeImmutable($row['expires_at']),
        );
    }
}
