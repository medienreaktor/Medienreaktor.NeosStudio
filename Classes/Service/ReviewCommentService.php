<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

use Medienreaktor\NeosStudio\Domain\Model\ReviewComment;
use Medienreaktor\NeosStudio\Domain\Model\ReviewCommentAnchor;
use Medienreaktor\NeosStudio\Domain\Repository\ReviewCommentRepository;
use Neos\ContentRepository\Core\SharedModel\ContentRepository\ContentRepositoryId;
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\Model\UserId;
use Neos\Neos\Domain\Model\WorkspaceRoleSubjectType;
use Neos\Neos\Domain\Service\UserService;
use Neos\Neos\Domain\Service\WorkspaceService;

/**
 * The conversation about a workspace's pending changes: the general thread and
 * the comments pinned to single changes, plus who hears about them.
 *
 * Deliberately not part of the task workflow. A review is a review whether or
 * not a task branch is involved - the common case is a shared draft against
 * live - and tying the conversation to tasks would have left exactly that case
 * mute. {@see TaskWorkspaceService} uses the same storage for the comments its
 * transitions produce (the submit comment, the reason a review was handed
 * back), so a task's thread is one thread, not two.
 */
#[Flow\Scope('singleton')]
final class ReviewCommentService
{
    public const NOTIFICATION_SOURCE = 'Medienreaktor.NeosStudio';

    #[Flow\Inject]
    protected ReviewCommentRepository $reviewCommentRepository;

    #[Flow\Inject]
    protected NotificationService $notificationService;

    #[Flow\Inject]
    protected WorkspaceService $workspaceService;

    #[Flow\Inject]
    protected UserService $userService;

    /**
     * The workspace's comments, oldest first - anchored and general together.
     *
     * @return array<ReviewComment>
     */
    public function getComments(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): array
    {
        return $this->reviewCommentRepository->findByWorkspaceName($contentRepositoryId, $workspaceName);
    }

    /**
     * Comment on the workspace's changes - on one of them when an anchor is
     * given, on the review as a whole otherwise. Everyone involved is notified
     * (see recipients()), except the author.
     */
    public function comment(
        ContentRepositoryId $contentRepositoryId,
        WorkspaceName $workspaceName,
        UserId $authorUserId,
        string $text,
        ?ReviewCommentAnchor $anchor = null,
    ): ReviewComment {
        $recipients = $this->recipients($contentRepositoryId, $workspaceName, $authorUserId);

        $comment = $this->reviewCommentRepository->add($contentRepositoryId, new ReviewComment(
            null,
            $workspaceName,
            $authorUserId,
            $text,
            new \DateTimeImmutable(),
            $anchor,
        ));

        $title = $this->workspaceTitle($contentRepositoryId, $workspaceName);
        $this->notificationService->notifyUsers(
            $recipients,
            self::NOTIFICATION_SOURCE,
            'review.commented',
            sprintf('New comment: %s', $title),
            sprintf('%s commented on the changes in "%s": %s', $this->userLabel($authorUserId), $title, $this->excerpt($text)),
            // The payload is what the notification bell navigates by: the
            // workspace opens the review, the ids take it to the very change.
            array_filter([
                'workspaceName' => $workspaceName->value,
                'documentAggregateId' => $anchor?->documentAggregateId->value,
                'nodeAggregateId' => $anchor?->nodeAggregateId->value,
                'target' => 'review',
            ], static fn ($value) => $value !== null),
        );

        return $comment;
    }

    /**
     * Mark a comment settled, or unsettle it again. Resolving is what keeps a
     * long-lived draft workspace's review readable: the comments about changes
     * that have been dealt with fold away instead of piling up forever.
     */
    public function setResolved(
        ContentRepositoryId $contentRepositoryId,
        int $commentId,
        UserId $actingUserId,
        bool $resolved,
    ): ?ReviewComment {
        if ($this->reviewCommentRepository->findById($contentRepositoryId, $commentId) === null) {
            return null;
        }
        $this->reviewCommentRepository->setResolved(
            $contentRepositoryId,
            $commentId,
            $resolved ? $actingUserId : null,
            $resolved ? new \DateTimeImmutable() : null,
        );

        return $this->reviewCommentRepository->findById($contentRepositoryId, $commentId);
    }

    public function delete(ContentRepositoryId $contentRepositoryId, int $commentId): void
    {
        $this->reviewCommentRepository->remove($contentRepositoryId, $commentId);
    }

    public function findById(ContentRepositoryId $contentRepositoryId, int $commentId): ?ReviewComment
    {
        return $this->reviewCommentRepository->findById($contentRepositoryId, $commentId);
    }

    /**
     * @return array<string, int> comment counts keyed by workspace name
     */
    public function countsByWorkspaceName(ContentRepositoryId $contentRepositoryId): array
    {
        return $this->reviewCommentRepository->countsByWorkspaceName($contentRepositoryId);
    }

    public function countForWorkspaceName(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): int
    {
        return $this->reviewCommentRepository->countForWorkspaceName($contentRepositoryId, $workspaceName);
    }

    // ------------------

    /**
     * Who hears about a comment: everyone already in the conversation, plus
     * everyone the workspace names PERSONALLY - a task's creator and assignee
     * are exactly that, so the task case needs no special handling.
     *
     * Group assignments are deliberately skipped. A shared draft grants
     * collaboration to a whole editor role; notifying it would mail the entire
     * editorial team on every remark, and the one group that genuinely needs
     * telling - the reviewers - is told by the review request itself.
     *
     * @return array<UserId>
     */
    private function recipients(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName, UserId $authorUserId): array
    {
        $candidates = array_map(
            static fn (ReviewComment $comment) => $comment->authorUserId,
            $this->reviewCommentRepository->findByWorkspaceName($contentRepositoryId, $workspaceName)
        );

        try {
            foreach ($this->workspaceService->getWorkspaceRoleAssignments($contentRepositoryId, $workspaceName) as $assignment) {
                if ($assignment->subject->type !== WorkspaceRoleSubjectType::USER) {
                    continue;
                }
                $candidates[] = UserId::fromString($assignment->subject->value);
            }
        } catch (\Exception) {
            // A workspace without metadata (or one just removed) simply has
            // nobody to name - the thread's own participants remain.
        }

        return array_values(array_filter(
            $candidates,
            static fn (?UserId $id) => $id !== null && !$id->equals($authorUserId)
        ));
    }

    private function workspaceTitle(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): string
    {
        try {
            return $this->workspaceService->getWorkspaceMetadata($contentRepositoryId, $workspaceName)->title->value;
        } catch (\Exception) {
            return $workspaceName->value;
        }
    }

    private function userLabel(UserId $userId): string
    {
        return $this->userService->findUserById($userId)?->getLabel() ?? $userId->value;
    }

    /** Comments can be long; notification messages carry a teaser only. */
    private function excerpt(string $text, int $maxLength = 140): string
    {
        $text = trim(preg_replace('/\s+/', ' ', $text) ?? $text);

        return mb_strlen($text) > $maxLength ? mb_substr($text, 0, $maxLength - 1) . '…' : $text;
    }
}
