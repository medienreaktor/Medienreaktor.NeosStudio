<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Domain\Model;

use Neos\ContentRepository\Core\DimensionSpace\DimensionSpacePoint;
use Neos\ContentRepository\Core\SharedModel\ContentRepository\ContentRepositoryId;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAddress;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAggregateId;
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\Model\UserId;

/**
 * A shareable preview link: a capability granting anonymous, read-only,
 * frontend-mode access to exactly one document (workspace + dimension +
 * aggregate pinned at creation) until it expires.
 *
 * Deliberately NOT an OAuth token: OAuth tokens authenticate an account
 * against the whole API surface and follow that account's session lifecycle
 * (1h TTL, refresh, logout-everywhere revocation). A preview link is a
 * standalone URL secret with its own bounded lifetime - only its SHA-256
 * hash is persisted, the secret exists in the generated URL alone.
 */
#[Flow\Proxy(false)]
final readonly class PreviewLink
{
    public function __construct(
        public string $id,
        public string $tokenHash,
        public ContentRepositoryId $contentRepositoryId,
        public WorkspaceName $workspaceName,
        public DimensionSpacePoint $dimensionSpacePoint,
        public NodeAggregateId $nodeAggregateId,
        public string $label,
        public UserId $createdByUserId,
        public \DateTimeImmutable $createdAt,
        public \DateTimeImmutable $expiresAt,
    ) {
    }

    /** The pinned document, in the address shape every renderer expects. */
    public function nodeAddress(): NodeAddress
    {
        return NodeAddress::create(
            $this->contentRepositoryId,
            $this->workspaceName,
            $this->dimensionSpacePoint,
            $this->nodeAggregateId
        );
    }

    public function isExpired(\DateTimeImmutable $now): bool
    {
        return $this->expiresAt <= $now;
    }
}
