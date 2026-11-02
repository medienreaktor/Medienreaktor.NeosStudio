<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;


use Medienreaktor\NeosStudio\Domain\Model\ReviewComment;
use Medienreaktor\NeosStudio\Domain\Model\TaskStatus;
use Medienreaktor\NeosStudio\Domain\Model\TaskWorkspace;
use Medienreaktor\NeosStudio\Domain\Repository\ReviewCommentRepository;
use Medienreaktor\NeosStudio\Domain\Repository\TaskWorkspaceRepository;
use Neos\ContentRepository\Core\Feature\WorkspaceModification\Command\ChangeBaseWorkspace;
use Neos\ContentRepository\Core\SharedModel\ContentRepository\ContentRepositoryId;
use Neos\ContentRepository\Core\SharedModel\Workspace\Workspace;
use Neos\ContentRepositoryRegistry\ContentRepositoryRegistry;
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\Security\Context as SecurityContext;
use Neos\Neos\Domain\Model\UserId;
use Neos\Neos\Domain\Model\WorkspaceDescription;
use Neos\Neos\Domain\Model\WorkspaceRole;
use Neos\Neos\Domain\Model\WorkspaceRoleAssignment;
use Neos\Neos\Domain\Model\WorkspaceRoleAssignments;
use Neos\Neos\Domain\Model\WorkspaceRoleSubject;
use Neos\Neos\Domain\Model\WorkspaceRoleSubjectType;
use Neos\Neos\Domain\Model\WorkspaceTitle;
use Neos\Neos\Domain\Service\UserService;
use Neos\Neos\Domain\Service\WorkspaceService;

/**
 * Central authority for task workspaces - the feature-branch workflow on top
 * of Neos workspaces.
 *
 * A task workspace is a plain SHARED content repository workspace (created
 * through the Neos WorkspaceService, so nothing in the core needs patching)
 * plus a sidecar record carrying type/status/assignee. Visibility is driven
 * purely by workspace role assignments: the creator manages, the assignee
 * collaborates, reviewers (a configurable Flow role) manage - and because no
 * blanket editor role is granted, uninvolved editors do not even see the
 * branch in their workspace pickers.
 *
 * Workspace-level authorization is enforced by the Neos WorkspaceService /
 * content repository, based on the acting (authenticated) user; the API
 * controller performs the workflow-level permission checks.
 */
#[Flow\Scope('singleton')]
final class TaskWorkspaceService
{
    public const NOTIFICATION_SOURCE = 'Medienreaktor.NeosStudio';

    #[Flow\Inject]
    protected WorkspaceService $workspaceService;

    #[Flow\Inject]
    protected TaskWorkspaceRepository $taskWorkspaceRepository;

    #[Flow\Inject]
    protected ReviewCommentRepository $reviewCommentRepository;

    #[Flow\Inject]
    protected NotificationService $notificationService;

    #[Flow\Inject]
    protected UserService $userService;

    /**
     * Flow role whose members review task workspaces: they get MANAGER on
     * every task workspace and are notified on review submissions.
     */
    #[Flow\InjectConfiguration(package: 'Medienreaktor.NeosStudio', path: 'taskWorkflow.reviewerRole')]
    protected string $reviewerRole;

    /**
     * Workspace new task branches are based on; null = derive it (see
     * defaultBaseWorkspaceName).
     */
    #[Flow\InjectConfiguration(package: 'Medienreaktor.NeosStudio', path: 'taskWorkflow.defaultBaseWorkspace')]
    protected ?string $defaultBaseWorkspace = null;

    #[Flow\Inject]
    protected ContentRepositoryRegistry $contentRepositoryRegistry;

    #[Flow\Inject]
    protected AccessControlService $accessControlService;

    #[Flow\Inject]
    protected SecurityContext $securityContext;

    public function getTask(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): ?TaskWorkspace
    {
        return $this->taskWorkspaceRepository->findByWorkspaceName($contentRepositoryId, $workspaceName);
    }

    /**
     * @return array<string, TaskWorkspace> keyed by workspace name
     */
    public function findAllTasks(ContentRepositoryId $contentRepositoryId): array
    {
        return $this->taskWorkspaceRepository->findAll($contentRepositoryId);
    }

    /**
     * Where a new task branch hangs when the caller does not say - and
     * therefore where publishing OUT of a task lands.
     *
     * Deliberately not live by default. A task is a side branch of ordinary
     * editorial work; basing it on live means publishing a task puts content
     * on the public site in one step, bypassing whatever review workspace the
     * rest of the editorial flow runs through. Configuration wins, because
     * personal workspaces are frequently based on live themselves, which makes
     * "derive it from the creator" reproduce exactly the setup it is meant to
     * avoid. Live remains the last resort - it is the one workspace that is
     * always there.
     *
     * The configured workspace only counts when the creator may read it -
     * creating a branch on a base they cannot read is refused by the content
     * repository. Derived from the creator, it is the first workspace below
     * their personal one that is not a task: working on a task re-bases the
     * personal workspace onto that task, and a new task must not silently
     * stack on top of the one they happen to be on.
     */
    public function defaultBaseWorkspaceName(ContentRepositoryId $contentRepositoryId, UserId $creatorUserId): WorkspaceName
    {
        $contentRepository = $this->contentRepositoryRegistry->get($contentRepositoryId);
        if ($this->defaultBaseWorkspace !== null && $this->defaultBaseWorkspace !== '') {
            try {
                $configured = WorkspaceName::fromString($this->defaultBaseWorkspace);
                if ($contentRepository->findWorkspaceByName($configured) !== null
                    && $this->accessControlService->canReadWorkspace($contentRepositoryId, $configured, $creatorUserId)
                ) {
                    return $configured;
                }
            } catch (\InvalidArgumentException) {
                // A misconfigured name must not stop task creation; the
                // fallbacks below still produce a usable branch.
            }
        }

        try {
            $personal = $this->workspaceService->getPersonalWorkspaceForUser($contentRepositoryId, $creatorUserId);
        } catch (\Exception) {
            return WorkspaceName::forLive();
        }
        $base = $personal->baseWorkspaceName;
        // Bounded: a base chain is short, and a cycle would be a corrupt
        // repository - not a reason to hang the request.
        for ($depth = 0; $base !== null && $depth < 16; $depth++) {
            if ($this->taskWorkspaceRepository->findByWorkspaceName($contentRepositoryId, $base) === null) {
                return $base;
            }
            $base = $contentRepository->findWorkspaceByName($base)?->baseWorkspaceName;
        }

        return WorkspaceName::forLive();
    }

    public function createTaskWorkspace(
        ContentRepositoryId $contentRepositoryId,
        WorkspaceTitle $title,
        WorkspaceDescription $description,
        WorkspaceName $baseWorkspaceName,
        UserId $creatorUserId,
        ?UserId $assigneeUserId = null,
    ): WorkspaceName {
        $workspaceName = $this->workspaceService->getUniqueWorkspaceName(
            $contentRepositoryId,
            'task-' . $title->value
        );

        $assignments = [
            WorkspaceRoleAssignment::createForUser($creatorUserId, WorkspaceRole::MANAGER),
            WorkspaceRoleAssignment::createForGroup($this->reviewerRole, WorkspaceRole::MANAGER),
        ];
        if ($assigneeUserId !== null && !$assigneeUserId->equals($creatorUserId)) {
            $assignments[] = WorkspaceRoleAssignment::createForUser($assigneeUserId, WorkspaceRole::COLLABORATOR);
        }

        // Deliberately NOT WorkspaceRoleAssignments::createForSharedWorkspace():
        // that would grant every AbstractEditor collaboration, making the task
        // branch appear in everyone's pickers. Involved people only.
        $this->workspaceService->createSharedWorkspace(
            $contentRepositoryId,
            $workspaceName,
            $title,
            $description,
            $baseWorkspaceName,
            WorkspaceRoleAssignments::fromArray($assignments)
        );

        $task = new TaskWorkspace(
            $workspaceName,
            TaskStatus::OPEN,
            $assigneeUserId,
            $creatorUserId,
            new \DateTimeImmutable(),
        );
        $this->taskWorkspaceRepository->add($contentRepositoryId, $task);

        if ($assigneeUserId !== null && !$assigneeUserId->equals($creatorUserId)) {
            $this->notifyAssigned($assigneeUserId, $task, $title->value);
        }

        return $workspaceName;
    }

    /**
     * (Re-)assign the task to a user (or nobody). Adjusts the workspace role
     * assignments so the assignee can actually work in the branch.
     */
    public function assignTask(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName, ?UserId $assigneeUserId, UserId $actingUserId): void
    {
        $task = $this->requireTask($contentRepositoryId, $workspaceName);
        if ($task->assigneeUserId !== null && $assigneeUserId !== null && $task->assigneeUserId->equals($assigneeUserId)) {
            return;
        }

        // The previous assignee loses their COLLABORATOR grant - unless they
        // hold it for another reason (creator = MANAGER stays untouched).
        if ($task->assigneeUserId !== null
            && !$task->assigneeUserId->equals($task->createdByUserId)
            && $this->hasUserRoleAssignment($contentRepositoryId, $workspaceName, $task->assigneeUserId)
        ) {
            $this->workspaceService->unassignWorkspaceRole(
                $contentRepositoryId,
                $workspaceName,
                WorkspaceRoleSubject::createForUser($task->assigneeUserId)
            );
        }

        if ($assigneeUserId !== null
            && !$assigneeUserId->equals($task->createdByUserId)
            && !$this->hasUserRoleAssignment($contentRepositoryId, $workspaceName, $assigneeUserId)
        ) {
            $this->workspaceService->assignWorkspaceRole(
                $contentRepositoryId,
                $workspaceName,
                WorkspaceRoleAssignment::createForUser($assigneeUserId, WorkspaceRole::COLLABORATOR)
            );
        }

        $this->taskWorkspaceRepository->updateAssignee($contentRepositoryId, $workspaceName, $assigneeUserId);

        if ($assigneeUserId !== null && !$assigneeUserId->equals($actingUserId)) {
            $this->notifyAssigned($assigneeUserId, $task, $this->workspaceTitle($contentRepositoryId, $workspaceName));
        }
    }

    /**
     * Hand the task to the reviewers: status IN_REVIEW, all users with the
     * reviewer role get notified. An optional comment joins the task's
     * comment thread and rides along in the notification - no separate
     * comment notification, the review request IS the news.
     */
    public function submitForReview(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName, UserId $actingUserId, string $comment = ''): void
    {
        $task = $this->requireTask($contentRepositoryId, $workspaceName);
        if ($task->status === TaskStatus::DONE) {
            throw new \RuntimeException(sprintf('Task workspace "%s" is already done.', $workspaceName->value), 1753776020);
        }

        $this->taskWorkspaceRepository->updateStatus($contentRepositoryId, $workspaceName, TaskStatus::IN_REVIEW);

        if ($comment !== '') {
            $this->reviewCommentRepository->add($contentRepositoryId, new ReviewComment(
                null,
                $workspaceName,
                $actingUserId,
                $comment,
                new \DateTimeImmutable(),
            ));
        }

        $title = $this->workspaceTitle($contentRepositoryId, $workspaceName);
        $this->notificationService->notifyUsersWithRole(
            $this->reviewerRole,
            self::NOTIFICATION_SOURCE,
            'taskWorkflow.submitted',
            sprintf('Review requested: %s', $title),
            $comment !== ''
                ? sprintf('%s asked for a review of the task "%s": %s', $this->userLabel($actingUserId), $title, $this->excerpt($comment))
                : sprintf('%s asked for a review of the task "%s".', $this->userLabel($actingUserId), $title),
            $this->payload($task),
            excludedUserIds: [$actingUserId],
        );
    }

    /**
     * Comment counts for all task workspaces at once, keyed by workspace
     * name (workspaces without comments are absent) - for the task listing.
     *
     * @return array<string, int>
     */
    public function getCommentCounts(ContentRepositoryId $contentRepositoryId): array
    {
        return $this->reviewCommentRepository->countsByWorkspaceName($contentRepositoryId);
    }

    public function countComments(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): int
    {
        return $this->reviewCommentRepository->countForWorkspaceName($contentRepositoryId, $workspaceName);
    }

    /**
     * Take the task back into work - a reviewer handing it back with what
     * needs doing.
     *
     * The reason joins the task's comment thread, exactly as the submit
     * comment does. A notification is read once and gone; what a review asked
     * for has to still be there tomorrow, next to the change it is about.
     */
    public function reopenTask(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName, UserId $actingUserId, string $reason = ''): void
    {
        $task = $this->requireTask($contentRepositoryId, $workspaceName);
        $this->taskWorkspaceRepository->updateStatus($contentRepositoryId, $workspaceName, TaskStatus::OPEN);

        if ($reason !== '') {
            $this->reviewCommentRepository->add($contentRepositoryId, new ReviewComment(
                null,
                $workspaceName,
                $actingUserId,
                $reason,
                new \DateTimeImmutable(),
            ));
        }

        $title = $this->workspaceTitle($contentRepositoryId, $workspaceName);
        $recipients = array_filter(
            [$task->assigneeUserId, $task->createdByUserId],
            static fn (?UserId $id) => $id !== null && !$id->equals($actingUserId)
        );
        $this->notificationService->notifyUsers(
            $recipients,
            self::NOTIFICATION_SOURCE,
            'taskWorkflow.reopened',
            sprintf('Reopened: %s', $title),
            $reason !== ''
                ? sprintf('%s reopened the task "%s": %s', $this->userLabel($actingUserId), $title, $this->excerpt($reason))
                : sprintf('%s reopened the task "%s".', $this->userLabel($actingUserId), $title),
            $this->payload($task),
        );
    }

    /**
     * Mark the task done. Deliberately does NOT publish: publishing happens
     * through the normal review flow (Studio's Review Changes dialog, the
     * Workspace module, CLI, ...) where the reviewer picks what to publish;
     * completing is the editorial bookkeeping afterwards. A FULL publish of
     * the workspace also completes the task automatically via the lifecycle
     * hook.
     */
    public function completeTask(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): void
    {
        $this->requireTask($contentRepositoryId, $workspaceName);
        $this->taskWorkspaceRepository->updateStatus($contentRepositoryId, $workspaceName, TaskStatus::DONE);
    }

    /**
     * Update the editable task details: workspace title and description,
     * through the WorkspaceService (which enforces manage permission).
     */
    public function updateTask(
        ContentRepositoryId $contentRepositoryId,
        WorkspaceName $workspaceName,
        WorkspaceTitle $title,
        WorkspaceDescription $description,
    ): void {
        $this->requireTask($contentRepositoryId, $workspaceName);
        $this->workspaceService->setWorkspaceTitle($contentRepositoryId, $workspaceName, $title);
        $this->workspaceService->setWorkspaceDescription($contentRepositoryId, $workspaceName, $description);
    }

    /**
     * Delete the task workspace (content repository workspace + sidecar).
     * The lifecycle hook also removes the sidecar when the workspace is
     * deleted through other channels.
     *
     * Working on a task re-bases the worker's personal workspace onto it, and
     * the content repository deletes a workspace without asking who builds on
     * it - a workspace left on a deleted base can neither publish, discard nor
     * be re-based again. So the workspaces based on the task move down to the
     * task's own base first. That is a system action of the delete, which the
     * caller was already allowed: it runs whatever the workers' own workspaces
     * would let the caller do. A workspace still holding changes cannot move;
     * the task stays until its worker has published or discarded them.
     *
     * @throws TaskWorkspaceInUseException
     */
    public function deleteTaskWorkspace(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): void
    {
        $this->requireTask($contentRepositoryId, $workspaceName);
        $contentRepository = $this->contentRepositoryRegistry->get($contentRepositoryId);
        $dependents = array_values(array_filter(
            iterator_to_array($contentRepository->findWorkspaces()),
            static fn (Workspace $workspace) => $workspace->baseWorkspaceName?->equals($workspaceName) ?? false,
        ));
        $busy = array_filter($dependents, static fn (Workspace $workspace) => $workspace->hasPublishableChanges());
        if ($busy !== []) {
            throw new TaskWorkspaceInUseException(
                sprintf(
                    'The task is still worked on with unpublished changes in %s. Those changes have to be published or discarded first.',
                    implode(', ', array_map(fn (Workspace $workspace) => sprintf('"%s"', $this->workspaceTitle($contentRepositoryId, $workspace->workspaceName)), $busy)),
                ),
                1762099200,
            );
        }
        $newBase = $contentRepository->findWorkspaceByName($workspaceName)->baseWorkspaceName ?? WorkspaceName::forLive();
        $this->securityContext->withoutAuthorizationChecks(function () use ($contentRepository, $dependents, $newBase): void {
            foreach ($dependents as $dependent) {
                $contentRepository->handle(ChangeBaseWorkspace::create($dependent->workspaceName, $newBase));
            }
        });

        $this->workspaceService->deleteWorkspace($contentRepositoryId, $workspaceName);
        $this->taskWorkspaceRepository->remove($contentRepositoryId, $workspaceName);
        $this->reviewCommentRepository->removeForWorkspace($contentRepositoryId, $workspaceName);
    }

    // ------------------

    private function requireTask(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): TaskWorkspace
    {
        $task = $this->taskWorkspaceRepository->findByWorkspaceName($contentRepositoryId, $workspaceName);
        if ($task === null) {
            throw new \RuntimeException(sprintf('Workspace "%s" is not a task workspace (Content Repository "%s").', $workspaceName->value, $contentRepositoryId->value), 1753776021);
        }

        return $task;
    }

    private function notifyAssigned(UserId $assigneeUserId, TaskWorkspace $task, string $title): void
    {
        $this->notificationService->notify(
            $assigneeUserId,
            self::NOTIFICATION_SOURCE,
            'taskWorkflow.assigned',
            sprintf('Assigned to you: %s', $title),
            sprintf('You have been assigned the task "%s".', $title),
            $this->payload($task),
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(TaskWorkspace $task): array
    {
        return array_filter([
            'workspaceName' => $task->workspaceName->value,
        ], static fn ($value) => $value !== null);
    }

    private function workspaceTitle(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): string
    {
        return $this->workspaceService->getWorkspaceMetadata($contentRepositoryId, $workspaceName)->title->value;
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

    private function hasUserRoleAssignment(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName, UserId $userId): bool
    {
        foreach ($this->workspaceService->getWorkspaceRoleAssignments($contentRepositoryId, $workspaceName) as $assignment) {
            if ($assignment->subject->type === WorkspaceRoleSubjectType::USER && $assignment->subject->value === $userId->value) {
                return true;
            }
        }

        return false;
    }
}
