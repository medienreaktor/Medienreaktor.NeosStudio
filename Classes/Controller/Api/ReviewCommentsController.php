<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Controller\Api;

use Medienreaktor\NeosApi\Controller\Api\AbstractApiController;
use Medienreaktor\NeosApi\Service\WorkspaceSerializer;
use Medienreaktor\NeosStudio\Domain\Model\ReviewComment;
use Medienreaktor\NeosStudio\Domain\Model\ReviewCommentAnchor;
use Medienreaktor\NeosStudio\Service\ReviewCommentService;
use Neos\ContentRepository\Core\DimensionSpace\DimensionSpacePoint;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAggregateId;
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\Model\User;
use Neos\Neos\Domain\Service\UserService;

/**
 * The review conversation as a REST resource, layered on the NeosApi
 * conventions: same base controller, same OAuth bearer firewall, same scope
 * semantics.
 *
 * Hangs off the WORKSPACE rather than off a task, because that is what a
 * review is about (see {@see ReviewCommentService}). Reading the workspace is
 * the bar for joining its conversation - whoever may look at the changes may
 * say something about them.
 */
class ReviewCommentsController extends AbstractApiController
{
    #[Flow\Inject]
    protected ReviewCommentService $reviewCommentService;

    #[Flow\Inject]
    protected WorkspaceSerializer $workspaceSerializer;

    #[Flow\Inject]
    protected UserService $userService;

    /**
     * GET /api/workspaces/{workspaceName}/comments - the whole conversation,
     * oldest first: the general thread and every pinned comment in one
     * response. One request per review, not one per change.
     */
    public function indexAction(string $workspaceName): string
    {
        $this->requireScope('neos.read');
        $this->requireUser();
        $name = $this->parseWorkspaceName($workspaceName);
        $this->requireReadable($name);

        return $this->json([
            'comments' => array_map(
                $this->serializeComment(...),
                $this->reviewCommentService->getComments($this->getContentRepositoryId(), $name)
            ),
        ]);
    }

    /**
     * POST /api/workspaces/{workspaceName}/comments
     *
     * Body: {"text": "..."} for the general thread, plus
     * {"documentAggregateId": "...", "nodeAggregateId": "...",
     * "dimensions": {...}} to pin it to one change.
     *
     * Note: like all unsafe NeosApi-style endpoints, this skips Flow's CSRF
     * check - authorization comes from the bearer token, not the (same-origin)
     * backend session cookie that would otherwise trigger it.
     *
     * @param array<string, string> $dimensions
     */
    #[Flow\SkipCsrfProtection]
    public function createAction(
        string $workspaceName,
        string $text = '',
        ?string $documentAggregateId = null,
        ?string $nodeAggregateId = null,
        array $dimensions = [],
    ): string {
        $this->requireScope('neos.write');
        $user = $this->requireUser();
        $name = $this->parseWorkspaceName($workspaceName);
        $this->requireReadable($name);
        if (trim($text) === '') {
            $this->throwJsonStatus(400, 'invalid_comment', 'The comment must not be empty.');
        }

        $comment = $this->reviewCommentService->comment(
            $this->getContentRepositoryId(),
            $name,
            $user->getId(),
            trim($text),
            $this->parseAnchor($documentAggregateId, $nodeAggregateId, $dimensions),
        );

        return $this->json(['comment' => $this->serializeComment($comment)], 201);
    }

    /**
     * POST /api/workspaces/{workspaceName}/comments/{commentId}/resolve -
     * body: {"resolved": true|false}
     *
     * Settling a remark is part of working through a review, so write access
     * on the workspace is enough; the author may always settle their own.
     */
    #[Flow\SkipCsrfProtection]
    public function resolveAction(string $workspaceName, int $commentId, bool $resolved = true): string
    {
        $this->requireScope('neos.write');
        $user = $this->requireUser();
        $name = $this->parseWorkspaceName($workspaceName);
        $this->requireReadable($name);
        $comment = $this->requireComment($name, $commentId);
        $this->requireAuthorOrWriteAccess($name, $comment, $user);

        $updated = $this->reviewCommentService->setResolved(
            $this->getContentRepositoryId(),
            $commentId,
            $user->getId(),
            $resolved,
        );

        return $this->json(['comment' => $updated !== null ? $this->serializeComment($updated) : null]);
    }

    /**
     * DELETE /api/workspaces/{workspaceName}/comments/{commentId} - taking
     * back what you said. Managing the workspace also allows removing others'
     * comments (moderation of one's own review).
     */
    #[Flow\SkipCsrfProtection]
    public function deleteAction(string $workspaceName, int $commentId): string
    {
        $this->requireScope('neos.write');
        $user = $this->requireUser();
        $name = $this->parseWorkspaceName($workspaceName);
        $this->requireReadable($name);
        $comment = $this->requireComment($name, $commentId);
        if (
            $comment->authorUserId === null
            || !$comment->authorUserId->equals($user->getId())
        ) {
            $permissions = $this->workspaceSerializer->permissions($this->getContentRepositoryId(), $name);
            if (!$permissions->manage) {
                $this->throwJsonStatus(403, 'not_your_comment', 'Only the author may remove this comment.');
            }
        }

        $this->reviewCommentService->delete($this->getContentRepositoryId(), $commentId);

        return $this->json(['deleted' => $commentId]);
    }

    // ------------------

    private function parseWorkspaceName(string $workspaceName): WorkspaceName
    {
        try {
            return WorkspaceName::fromString($workspaceName);
        } catch (\InvalidArgumentException) {
            $this->throwJsonStatus(400, 'invalid_workspace_name', sprintf('"%s" is not a valid workspace name.', $workspaceName));
        }
    }

    /**
     * @param array<string, string> $dimensions
     */
    private function parseAnchor(?string $documentAggregateId, ?string $nodeAggregateId, array $dimensions): ?ReviewCommentAnchor
    {
        if ($nodeAggregateId === null || $nodeAggregateId === '') {
            return null;
        }
        if ($documentAggregateId === null || $documentAggregateId === '') {
            $this->throwJsonStatus(400, 'invalid_anchor', 'A comment pinned to a change must name the document it is on.');
        }

        try {
            return new ReviewCommentAnchor(
                NodeAggregateId::fromString($documentAggregateId),
                NodeAggregateId::fromString($nodeAggregateId),
                DimensionSpacePoint::fromArray(array_map(strval(...), $dimensions)),
            );
        } catch (\InvalidArgumentException $e) {
            $this->throwJsonStatus(400, 'invalid_anchor', $e->getMessage());
        }
    }

    private function requireUser(): User
    {
        $user = $this->userService->getCurrentUser();
        if ($user === null) {
            $this->throwJsonStatus(403, 'no_user', 'Commenting requires a token bound to a Neos user.');
        }

        return $user;
    }

    private function requireReadable(WorkspaceName $workspaceName): void
    {
        if (!$this->workspaceSerializer->canRead($this->getContentRepositoryId(), $workspaceName)) {
            $this->throwJsonStatus(403, 'insufficient_workspace_permissions', sprintf('You lack the required permission on workspace "%s".', $workspaceName->value));
        }
    }

    private function requireComment(WorkspaceName $workspaceName, int $commentId): ReviewComment
    {
        $comment = $this->reviewCommentService->findById($this->getContentRepositoryId(), $commentId);
        // Scoped to the workspace in the path: a comment id alone must not
        // reach across workspaces the account may not even read.
        if ($comment === null || !$comment->workspaceName->equals($workspaceName)) {
            $this->throwJsonStatus(404, 'comment_not_found', sprintf('Comment %d does not exist on workspace "%s".', $commentId, $workspaceName->value));
        }

        return $comment;
    }

    private function requireAuthorOrWriteAccess(WorkspaceName $workspaceName, ReviewComment $comment, User $user): void
    {
        if ($comment->authorUserId !== null && $comment->authorUserId->equals($user->getId())) {
            return;
        }
        $permissions = $this->workspaceSerializer->permissions($this->getContentRepositoryId(), $workspaceName);
        if (!$permissions->write) {
            $this->throwJsonStatus(403, 'insufficient_workspace_permissions', sprintf('You lack the required permission on workspace "%s".', $workspaceName->value));
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeComment(ReviewComment $comment): array
    {
        return [
            'id' => $comment->id,
            'author' => $comment->authorUserId?->value,
            // Labelled server-side (like the task enricher's assigneeLabel), so
            // the client never depends on being allowed to list all users.
            'authorLabel' => $comment->authorUserId !== null
                ? $this->userService->findUserById($comment->authorUserId)?->getLabel()
                : null,
            'text' => $comment->text,
            'createdAt' => $comment->createdAt->format(\DateTimeInterface::ATOM),
            'documentAggregateId' => $comment->anchor?->documentAggregateId->value,
            'nodeAggregateId' => $comment->anchor?->nodeAggregateId->value,
            'dimensions' => $comment->anchor?->dimensionSpacePoint->coordinates,
            'resolvedAt' => $comment->resolvedAt?->format(\DateTimeInterface::ATOM),
            'resolvedBy' => $comment->resolvedByUserId?->value,
        ];
    }
}
