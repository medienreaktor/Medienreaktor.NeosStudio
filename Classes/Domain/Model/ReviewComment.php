<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Domain\Model;

use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\Neos\Domain\Model\UserId;

/**
 * One comment on a workspace's pending changes.
 *
 * Comments belong to the WORKSPACE, not to the task workflow: the review that
 * matters in most installations is a shared draft against live, which is not a
 * task branch and would otherwise have no way to talk about its changes. A
 * task workspace is simply a workspace whose comments are also part of its
 * workflow - the submit comment, the reason a review was handed back.
 *
 * Without an {@see ReviewCommentAnchor} the comment belongs to the workspace's
 * general thread; with one it is pinned to a single change, which is what the
 * side-by-side compare view reads them out of. Comments live and die with the
 * workspace.
 */
final readonly class ReviewComment
{
    public function __construct(
        /** Database id; null until persisted. */
        public ?int $id,
        public WorkspaceName $workspaceName,
        public ?UserId $authorUserId,
        public string $text,
        public \DateTimeImmutable $createdAt,
        /** The change this comment is pinned to; null = the general thread. */
        public ?ReviewCommentAnchor $anchor = null,
        public ?\DateTimeImmutable $resolvedAt = null,
        public ?UserId $resolvedByUserId = null,
    ) {
    }

    public function isResolved(): bool
    {
        return $this->resolvedAt !== null;
    }
}
