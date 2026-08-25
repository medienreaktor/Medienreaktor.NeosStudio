<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Controller\Api;

use Medienreaktor\NeosApi\Controller\Api\AbstractApiController;
use Medienreaktor\NeosApi\Service\WorkspaceSerializer;
use Medienreaktor\NeosStudio\Domain\Model\TaskWorkspace;
use Medienreaktor\NeosStudio\Service\TaskWorkspaceService;
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\Model\User;
use Neos\Neos\Domain\Model\UserId;
use Neos\Neos\Domain\Model\WorkspaceDescription;
use Neos\Neos\Domain\Model\WorkspacePermissions;
use Neos\Neos\Domain\Model\WorkspaceTitle;
use Neos\Neos\Domain\Service\UserService;

/**
 * The task-workflow REST API, layered on the NeosApi conventions: same base
 * controller, same OAuth bearer firewall (request pattern in Settings.yaml),
 * same scope semantics (read/write/publish), plus per-workspace permission
 * checks - the roles a task workspace got at creation (creator: MANAGER,
 * reviewers: MANAGER, assignee: COLLABORATOR) directly drive who may do what.
 */
class TasksController extends AbstractApiController
{
    #[Flow\Inject]
    protected TaskWorkspaceService $taskWorkspaceService;

    #[Flow\Inject]
    protected WorkspaceSerializer $workspaceSerializer;

    #[Flow\Inject]
    protected UserService $userService;

    /**
     * GET /api/tasks - all task workspaces the account may read
     */
    public function indexAction(): string
    {
        $this->requireScope('neos.read');
        $commentCounts = $this->taskWorkspaceService->getCommentCounts($this->getContentRepositoryId());
        $tasks = [];
        foreach ($this->taskWorkspaceService->findAllTasks($this->getContentRepositoryId()) as $task) {
            if (!$this->workspaceSerializer->canRead($this->getContentRepositoryId(), $task->workspaceName)) {
                continue;
            }
            $tasks[] = $this->serializeTask($task, $commentCounts[$task->workspaceName->value] ?? 0);
        }

        // Where a new task would hang - the creation dialog preselects it and
        // names it, so "publishing this task goes to X" is decided in the open
        // rather than discovered at the first publish.
        $user = $this->userService->getCurrentUser();

        return $this->json([
            'tasks' => $tasks,
            'defaultBaseWorkspace' => $user === null
                ? null
                : $this->taskWorkspaceService->defaultBaseWorkspaceName($this->getContentRepositoryId(), $user->getId())->value,
        ]);
    }

    /**
     * POST /api/tasks
     *
     * Note: like all unsafe NeosApi-style endpoints, the write actions skip
     * Flow's CSRF check - authorization comes from the bearer token, not the
     * (same-origin) backend session cookie that would otherwise trigger it.
     */
    #[Flow\SkipCsrfProtection]
    public function createAction(
        string $title,
        string $description = '',
        ?string $baseWorkspace = null,
        ?string $assignee = null,
    ): string {
        $this->requireScope('neos.write');
        $user = $this->requireUser();

        if (trim($title) === '') {
            $this->throwJsonStatus(400, 'invalid_title', 'The title must not be empty.');
        }

        $workspaceName = $this->taskWorkspaceService->createTaskWorkspace(
            $this->getContentRepositoryId(),
            WorkspaceTitle::fromString(trim($title)),
            WorkspaceDescription::fromString(trim($description)),
            // Not "live" by default - see defaultBaseWorkspaceName().
            $baseWorkspace === null || $baseWorkspace === ''
                ? $this->taskWorkspaceService->defaultBaseWorkspaceName($this->getContentRepositoryId(), $user->getId())
                : $this->parseWorkspaceName($baseWorkspace),
            $user->getId(),
            $assignee !== null && $assignee !== '' ? $this->parseUserId($assignee, 'invalid_assignee') : null,
        );

        $task = $this->taskWorkspaceService->getTask($this->getContentRepositoryId(), $workspaceName);

        return $this->json(['task' => $this->serializeTask($task)], 201);
    }

    /**
     * POST /api/tasks/{workspaceName}/assign - body: {"assignee": "<user-id>"} or {"assignee": null}
     */
    #[Flow\SkipCsrfProtection]
    public function assignAction(string $workspaceName, ?string $assignee = null): string
    {
        $this->requireScope('neos.write');
        $user = $this->requireUser();
        $name = $this->parseWorkspaceName($workspaceName);
        $this->requireTask($name);
        $this->requirePermission($name, manage: true);

        $this->taskWorkspaceService->assignTask(
            $this->getContentRepositoryId(),
            $name,
            $assignee !== null && $assignee !== '' ? $this->parseUserId($assignee, 'invalid_assignee') : null,
            $user->getId(),
        );

        return $this->json(['task' => $this->serializeTask($this->taskWorkspaceService->getTask($this->getContentRepositoryId(), $name))]);
    }

    /**
     * POST /api/tasks/{workspaceName}/submit - hand the task to the
     * reviewers, optionally with a comment for them
     */
    #[Flow\SkipCsrfProtection]
    public function submitAction(string $workspaceName, string $comment = ''): string
    {
        $this->requireScope('neos.write');
        $user = $this->requireUser();
        $name = $this->parseWorkspaceName($workspaceName);
        $this->requireTask($name);
        $this->requirePermission($name, write: true);

        $this->taskWorkspaceService->submitForReview($this->getContentRepositoryId(), $name, $user->getId(), trim($comment));

        return $this->json(['task' => $this->serializeTask($this->taskWorkspaceService->getTask($this->getContentRepositoryId(), $name))]);
    }

    /**
     * POST /api/tasks/{workspaceName}/approve - mark the task done. Does NOT
     * publish; publishing goes through the normal review flow (a full publish
     * of the workspace completes the task automatically via the lifecycle
     * hook, this endpoint covers the "publish selected changes, then close
     * the task" flow).
     */
    #[Flow\SkipCsrfProtection]
    public function approveAction(string $workspaceName): string
    {
        $this->requireScope('neos.write');
        $this->requireUser();
        $name = $this->parseWorkspaceName($workspaceName);
        $this->requireTask($name);
        $this->requirePermission($name, manage: true);

        $this->taskWorkspaceService->completeTask($this->getContentRepositoryId(), $name);

        return $this->json(['task' => $this->serializeTask($this->taskWorkspaceService->getTask($this->getContentRepositoryId(), $name))]);
    }

    /**
     * POST /api/tasks/{workspaceName} - update the editable details (title,
     * description)
     */
    #[Flow\SkipCsrfProtection]
    public function updateAction(
        string $workspaceName,
        string $title,
        string $description = '',
    ): string {
        $this->requireScope('neos.write');
        $this->requireUser();
        $name = $this->parseWorkspaceName($workspaceName);
        $this->requireTask($name);
        $this->requirePermission($name, manage: true);
        if (trim($title) === '') {
            $this->throwJsonStatus(400, 'invalid_title', 'The title must not be empty.');
        }

        $this->taskWorkspaceService->updateTask(
            $this->getContentRepositoryId(),
            $name,
            WorkspaceTitle::fromString(trim($title)),
            WorkspaceDescription::fromString(trim($description)),
        );

        return $this->json(['task' => $this->serializeTask($this->taskWorkspaceService->getTask($this->getContentRepositoryId(), $name))]);
    }

    /**
     * POST /api/tasks/{workspaceName}/reopen - back into work (e.g. review rejected)
     */
    #[Flow\SkipCsrfProtection]
    public function reopenAction(string $workspaceName, string $reason = ''): string
    {
        $this->requireScope('neos.write');
        $user = $this->requireUser();
        $name = $this->parseWorkspaceName($workspaceName);
        $this->requireTask($name);
        $this->requirePermission($name, write: true);

        $this->taskWorkspaceService->reopenTask($this->getContentRepositoryId(), $name, $user->getId(), trim($reason));

        return $this->json(['task' => $this->serializeTask($this->taskWorkspaceService->getTask($this->getContentRepositoryId(), $name))]);
    }

    /**
     * DELETE /api/tasks/{workspaceName} - removes the workspace (discarding
     * its changes) and the task record
     */
    #[Flow\SkipCsrfProtection]
    public function deleteAction(string $workspaceName): string
    {
        $this->requireScope('neos.write');
        $this->requireUser();
        $name = $this->parseWorkspaceName($workspaceName);
        $this->requireTask($name);
        $this->requirePermission($name, manage: true);

        $this->taskWorkspaceService->deleteTaskWorkspace($this->getContentRepositoryId(), $name);

        return $this->json(['deleted' => $workspaceName]);
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

    private function parseUserId(string $userId, string $errorCode): UserId
    {
        try {
            return UserId::fromString($userId);
        } catch (\InvalidArgumentException) {
            $this->throwJsonStatus(400, $errorCode, sprintf('"%s" is not a valid user id.', $userId));
        }
    }

    private function requireUser(): User
    {
        $user = $this->userService->getCurrentUser();
        if ($user === null) {
            $this->throwJsonStatus(403, 'no_user', 'The task workflow requires a token bound to a Neos user.');
        }

        return $user;
    }

    private function requireTask(WorkspaceName $workspaceName): TaskWorkspace
    {
        $task = $this->taskWorkspaceService->getTask($this->getContentRepositoryId(), $workspaceName);
        if ($task === null) {
            $this->throwJsonStatus(404, 'task_not_found', sprintf('Workspace "%s" is not a task workspace.', $workspaceName->value));
        }

        return $task;
    }

    private function requirePermission(WorkspaceName $workspaceName, bool $write = false, bool $manage = false): WorkspacePermissions
    {
        $permissions = $this->workspaceSerializer->permissions($this->getContentRepositoryId(), $workspaceName);
        if (($manage && !$permissions->manage) || ($write && !$permissions->write)) {
            $this->throwJsonStatus(403, 'insufficient_workspace_permissions', sprintf('You lack the required permission on workspace "%s".', $workspaceName->value));
        }

        return $permissions;
    }

    /**
     * @param int|null $commentCount pre-fetched count (the listing batches them); null = count now
     * @return array<string, mixed>
     */
    private function serializeTask(TaskWorkspace $task, ?int $commentCount = null): array
    {
        // A null workspace (stale sidecar record, e.g. removal event not yet
        // caught up) serializes as workspace: null rather than failing the
        // whole listing.
        $workspace = $this->getContentRepository()->findWorkspaceByName($task->workspaceName);

        return [
            'workspaceName' => $task->workspaceName->value,
            'status' => $task->status->value,
            'assignee' => $task->assigneeUserId?->value,
            'createdBy' => $task->createdByUserId?->value,
            'createdAt' => $task->createdAt->format(\DateTimeInterface::ATOM),
            'commentCount' => $commentCount ?? $this->taskWorkspaceService->countComments($this->getContentRepositoryId(), $task->workspaceName),
            'workspace' => $workspace !== null
                ? $this->workspaceSerializer->serialize($this->getContentRepositoryId(), $workspace)
                : null,
        ];
    }
}
