<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Tasks;

use Medienreaktor\NeosStudio\Domain\Model;
use Medienreaktor\NeosStudio\Endpoint\Tasks\RequestBody\TaskAssigneeChange;
use Medienreaktor\NeosStudio\Endpoint\Tasks\RequestBody\TaskCommentCreate;
use Medienreaktor\NeosStudio\Endpoint\Tasks\RequestBody\TaskCreate;
use Medienreaktor\NeosStudio\Endpoint\Tasks\RequestBody\TaskReopen;
use Medienreaktor\NeosStudio\Endpoint\Tasks\RequestBody\TaskSubmit;
use Medienreaktor\NeosStudio\Endpoint\Tasks\RequestBody\TaskUpdate;
use Medienreaktor\NeosStudio\Endpoint\Tasks\Response\TaskCommentCreated;
use Medienreaktor\NeosStudio\Endpoint\Tasks\Response\TaskCreated;
use Medienreaktor\NeosStudio\Endpoint\Tasks\Schema\Task;
use Medienreaktor\NeosStudio\Endpoint\Tasks\Schema\TaskComment;
use Medienreaktor\NeosStudio\Endpoint\Tasks\Schema\TaskCommentList;
use Medienreaktor\NeosStudio\Endpoint\Tasks\Schema\TaskCommentListing;
use Medienreaktor\NeosStudio\Endpoint\Tasks\Schema\TaskList;
use Medienreaktor\NeosStudio\Endpoint\Tasks\Schema\TaskListing;
use Medienreaktor\NeosStudio\Security\StudioCallers;
use Medienreaktor\NeosStudio\Security\StudioScopes;
use Medienreaktor\NeosStudio\Service\TaskWorkspaceService;
use Neos\Api\Endpoint\ContentRepositories\Schema\ContentRepositoryId;
use Neos\Api\Endpoint\Users\Schema\UserId;
use Neos\Api\Endpoint\Workspaces\Schema\WorkspaceName;
use Neos\Api\Security\ApiAuthContextProvider;
use Neos\Api\Security\ApiCaller;
use Neos\Api\Shared\Response\Forbidden;
use Neos\Api\Shared\Response\NotFound;
use Neos\Api\Shared\Response\UnprocessableContent;
use Neos\ContentRepository\Core\ContentRepository;
use Neos\ContentRepository\Core\SharedModel;
use Neos\Neos\Domain\Model\User;
use Neos\Neos\Domain\Model\WorkspaceDescription;
use Neos\Neos\Domain\Model\WorkspaceTitle;
use Neos\Neos\Domain\Service\UserService;
use Neos\OpenApi\Attributes\AuthContext;
use Neos\OpenApi\Attributes\Operation;
use Neos\OpenApi\Attributes\RequestBody;

/**
 * The task workflow: a task is a shared workspace (its branch) plus the
 * Studio's record of who works on it and where it is (OPEN → IN_REVIEW →
 * DONE), in a content repository
 *
 * The workspace roles a task gets decide who may do what: its creator and the
 * reviewers (the reviewerRole setting) manage it, the assignee collaborates,
 * nobody else sees it. A task the caller may not read is a 404, as an unknown
 * one; an action their role doesn't allow a 403. The changes themselves are
 * made, reviewed and published with the Neos API's workspace and node
 * operations; a full publish of the workspace makes the task DONE.
 */
final readonly class Tasks
{
    public function __construct(
        private TaskWorkspaceService $taskWorkspaceService,
        private UserService $userService,
        private StudioCallers $studioCallers,
    ) {
    }

    #[Operation(
        path: '/cr/{contentRepositoryId}/tasks',
        method: 'GET',
        summary: 'List the tasks',
        description: 'The tasks whose workspace the caller may read, i.e. the ones they created, are assigned to or review.',
        operationId: 'listTasks',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::TASKS_READ],
        ],
    )]
    public function list(#[AuthContext] ApiCaller $caller, ContentRepositoryId $contentRepositoryId): TaskListing|NotFound
    {
        $contentRepository = $this->studioCallers->contentRepository($contentRepositoryId);
        if (!$contentRepository instanceof ContentRepository) {
            return $contentRepository;
        }
        $commentCounts = $this->taskWorkspaceService->getCommentCounts($contentRepository->id);
        $tasks = [];
        foreach ($this->taskWorkspaceService->findAllTasks($contentRepository->id) as $task) {
            if ($this->studioCallers->permissionsOf($caller, $contentRepository->id, $task->workspaceName)->read) {
                $tasks[] = $this->task($caller, $contentRepository, $task, $commentCounts[$task->workspaceName->value] ?? 0);
            }
        }
        return TaskListing::of(new TaskList(...$tasks));
    }

    #[Operation(
        path: '/cr/{contentRepositoryId}/tasks',
        method: 'POST',
        summary: 'Create a task',
        description: 'Creates the task\'s shared workspace on the base workspace, named after the title, with the caller and the reviewers as managers and the assignee as collaborator. The assignee is notified. An empty title, a base workspace the caller may not read or an unknown assignee is a 422.',
        operationId: 'createTask',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::TASKS_UPDATE],
        ],
    )]
    public function create(
        #[AuthContext] ApiCaller $caller,
        ContentRepositoryId $contentRepositoryId,
        #[RequestBody(description: 'The new task')] TaskCreate $newTask,
    ): TaskCreated|NotFound|Forbidden|UnprocessableContent {
        $contentRepository = $this->studioCallers->contentRepository($contentRepositoryId);
        if (!$contentRepository instanceof ContentRepository) {
            return $contentRepository;
        }
        $user = $this->studioCallers->requireUserOf($caller);
        if (!$user instanceof User) {
            return $user;
        }
        $title = trim($newTask->title);
        if ($title === '') {
            return UnprocessableContent::because('The title must not be empty');
        }
        $baseWorkspaceName = $newTask->baseWorkspaceName?->toWorkspaceName() ?? SharedModel\Workspace\WorkspaceName::forLive();
        if ($contentRepository->findWorkspaceByName($baseWorkspaceName) === null
            || !$this->studioCallers->permissionsOf($caller, $contentRepository->id, $baseWorkspaceName)->read
        ) {
            return UnprocessableContent::because(sprintf('There is no workspace %s', $baseWorkspaceName->value));
        }
        $assignee = $this->assigneeOf($newTask->assignee);
        if ($assignee instanceof UnprocessableContent) {
            return $assignee;
        }
        $workspaceName = $this->taskWorkspaceService->createTaskWorkspace(
            $contentRepository->id,
            WorkspaceTitle::fromString($title),
            WorkspaceDescription::fromString(trim($newTask->description ?? '')),
            $baseWorkspaceName,
            $user->getId(),
            $assignee,
        );
        return new TaskCreated($this->reread($caller, $contentRepositoryId, $workspaceName));
    }

    #[Operation(
        path: '/cr/{contentRepositoryId}/tasks/{workspaceName}',
        method: 'GET',
        summary: 'Get a task',
        description: 'The task of the workspace.',
        operationId: 'getTask',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::TASKS_READ],
        ],
    )]
    public function get(#[AuthContext] ApiCaller $caller, ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): Task|NotFound
    {
        $task = $this->resolve($caller, $contentRepositoryId, $workspaceName);
        if (!$task instanceof Model\TaskWorkspace) {
            return $task;
        }
        return $this->reread($caller, $contentRepositoryId, $task->workspaceName);
    }

    #[Operation(
        path: '/cr/{contentRepositoryId}/tasks/{workspaceName}',
        method: 'PATCH',
        summary: 'Update a task',
        description: 'Changes the title or description, which are the workspace\'s. Only for its managers (403 otherwise), an empty title is a 422.',
        operationId: 'updateTask',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::TASKS_UPDATE],
        ],
    )]
    public function update(
        #[AuthContext] ApiCaller $caller,
        ContentRepositoryId $contentRepositoryId,
        WorkspaceName $workspaceName,
        #[RequestBody(description: 'The changes, what is left out stays as it is')] TaskUpdate $changes,
    ): Task|NotFound|Forbidden|UnprocessableContent {
        $task = $this->resolveManageable($caller, $contentRepositoryId, $workspaceName);
        if (!$task instanceof Model\TaskWorkspace) {
            return $task;
        }
        if ($changes->title !== null && trim($changes->title) === '') {
            return UnprocessableContent::because('The title must not be empty');
        }
        $current = $this->reread($caller, $contentRepositoryId, $task->workspaceName)->workspace;
        $this->taskWorkspaceService->updateTask(
            $contentRepositoryId->toContentRepositoryId(),
            $task->workspaceName,
            WorkspaceTitle::fromString($changes->title !== null ? trim($changes->title) : (string)$current?->title),
            WorkspaceDescription::fromString($changes->description !== null ? trim($changes->description) : (string)$current?->description),
        );
        return $this->reread($caller, $contentRepositoryId, $task->workspaceName);
    }

    #[Operation(
        path: '/cr/{contentRepositoryId}/tasks/{workspaceName}',
        method: 'DELETE',
        summary: 'Delete a task',
        description: 'Removes the task\'s workspace with all its changes, and the task with its comments. Only for its managers (403 otherwise).',
        operationId: 'deleteTask',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::TASKS_UPDATE],
        ],
    )]
    public function delete(#[AuthContext] ApiCaller $caller, ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): NotFound|Forbidden|null
    {
        $task = $this->resolveManageable($caller, $contentRepositoryId, $workspaceName);
        if (!$task instanceof Model\TaskWorkspace) {
            return $task;
        }
        $this->taskWorkspaceService->deleteTaskWorkspace($contentRepositoryId->toContentRepositoryId(), $task->workspaceName);
        return null;
    }

    #[Operation(
        path: '/cr/{contentRepositoryId}/tasks/{workspaceName}/assignee',
        method: 'PUT',
        summary: 'Assign a task',
        description: 'Who works on the task from now on: the new assignee becomes collaborator of its workspace (and is notified), the previous one stops being one. Only for its managers (403 otherwise), an unknown user is a 422.',
        operationId: 'setTaskAssignee',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::TASKS_UPDATE],
        ],
    )]
    public function setAssignee(
        #[AuthContext] ApiCaller $caller,
        ContentRepositoryId $contentRepositoryId,
        WorkspaceName $workspaceName,
        #[RequestBody(description: 'The assignee, null for nobody')] TaskAssigneeChange $assignment,
    ): Task|NotFound|Forbidden|UnprocessableContent {
        $user = $this->studioCallers->requireUserOf($caller);
        if (!$user instanceof User) {
            return $user;
        }
        $task = $this->resolveManageable($caller, $contentRepositoryId, $workspaceName);
        if (!$task instanceof Model\TaskWorkspace) {
            return $task;
        }
        $assignee = $this->assigneeOf($assignment->assignee);
        if ($assignee instanceof UnprocessableContent) {
            return $assignee;
        }
        $this->taskWorkspaceService->assignTask($contentRepositoryId->toContentRepositoryId(), $task->workspaceName, $assignee, $user->getId());
        return $this->reread($caller, $contentRepositoryId, $task->workspaceName);
    }

    #[Operation(
        path: '/cr/{contentRepositoryId}/tasks/{workspaceName}/submit',
        method: 'POST',
        summary: 'Submit a task for review',
        description: 'Hands the task to the reviewers: IN_REVIEW, and every reviewer is notified. For everybody who may write in its workspace (403 otherwise).',
        operationId: 'submitTask',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::TASKS_UPDATE],
        ],
    )]
    public function submit(
        #[AuthContext] ApiCaller $caller,
        ContentRepositoryId $contentRepositoryId,
        WorkspaceName $workspaceName,
        #[RequestBody(description: 'A comment for the reviewers, optional')] TaskSubmit $submission = new TaskSubmit(),
    ): Task|NotFound|Forbidden {
        $user = $this->studioCallers->requireUserOf($caller);
        if (!$user instanceof User) {
            return $user;
        }
        $task = $this->resolveWritable($caller, $contentRepositoryId, $workspaceName);
        if (!$task instanceof Model\TaskWorkspace) {
            return $task;
        }
        $this->taskWorkspaceService->submitForReview($contentRepositoryId->toContentRepositoryId(), $task->workspaceName, $user->getId(), trim($submission->comment ?? ''));
        return $this->reread($caller, $contentRepositoryId, $task->workspaceName);
    }

    #[Operation(
        path: '/cr/{contentRepositoryId}/tasks/{workspaceName}/approve',
        method: 'POST',
        summary: 'Approve a task',
        description: 'Makes the task DONE, e.g. after some of its changes were published with publishWorkspace of the Neos API. It doesn\'t publish anything itself: publishing all of the workspace makes the task DONE anyway. Only for its managers (403 otherwise).',
        operationId: 'approveTask',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::TASKS_APPROVE],
        ],
    )]
    public function approve(#[AuthContext] ApiCaller $caller, ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): Task|NotFound|Forbidden
    {
        $task = $this->resolveManageable($caller, $contentRepositoryId, $workspaceName);
        if (!$task instanceof Model\TaskWorkspace) {
            return $task;
        }
        $this->taskWorkspaceService->completeTask($contentRepositoryId->toContentRepositoryId(), $task->workspaceName);
        return $this->reread($caller, $contentRepositoryId, $task->workspaceName);
    }

    #[Operation(
        path: '/cr/{contentRepositoryId}/tasks/{workspaceName}/reopen',
        method: 'POST',
        summary: 'Reopen a task',
        description: 'Puts the task back into work (OPEN), e.g. when the review found something; its assignee and creator are notified. For everybody who may write in its workspace (403 otherwise).',
        operationId: 'reopenTask',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::TASKS_UPDATE],
        ],
    )]
    public function reopen(
        #[AuthContext] ApiCaller $caller,
        ContentRepositoryId $contentRepositoryId,
        WorkspaceName $workspaceName,
        #[RequestBody(description: 'Why, optional')] TaskReopen $reopening = new TaskReopen(),
    ): Task|NotFound|Forbidden {
        $user = $this->studioCallers->requireUserOf($caller);
        if (!$user instanceof User) {
            return $user;
        }
        $task = $this->resolveWritable($caller, $contentRepositoryId, $workspaceName);
        if (!$task instanceof Model\TaskWorkspace) {
            return $task;
        }
        $this->taskWorkspaceService->reopenTask($contentRepositoryId->toContentRepositoryId(), $task->workspaceName, $user->getId(), trim($reopening->reason ?? ''));
        return $this->reread($caller, $contentRepositoryId, $task->workspaceName);
    }

    #[Operation(
        path: '/cr/{contentRepositoryId}/tasks/{workspaceName}/comments',
        method: 'GET',
        summary: 'List the comments of a task',
        description: 'Oldest first, with the authors\' names.',
        operationId: 'listTaskComments',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::TASKS_READ],
        ],
    )]
    public function listComments(#[AuthContext] ApiCaller $caller, ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): TaskCommentListing|NotFound
    {
        $task = $this->resolve($caller, $contentRepositoryId, $workspaceName);
        if (!$task instanceof Model\TaskWorkspace) {
            return $task;
        }
        return TaskCommentListing::of(new TaskCommentList(...array_map(
            $this->comment(...),
            $this->taskWorkspaceService->getComments($contentRepositoryId->toContentRepositoryId(), $task->workspaceName),
        )));
    }

    #[Operation(
        path: '/cr/{contentRepositoryId}/tasks/{workspaceName}/comments',
        method: 'POST',
        summary: 'Comment on a task',
        description: 'Everybody who sees the task may join its conversation; the others involved are notified. An empty text is a 422.',
        operationId: 'createTaskComment',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::TASKS_UPDATE],
        ],
    )]
    public function createComment(
        #[AuthContext] ApiCaller $caller,
        ContentRepositoryId $contentRepositoryId,
        WorkspaceName $workspaceName,
        #[RequestBody(description: 'The comment')] TaskCommentCreate $newComment,
    ): TaskCommentCreated|NotFound|Forbidden|UnprocessableContent {
        $user = $this->studioCallers->requireUserOf($caller);
        if (!$user instanceof User) {
            return $user;
        }
        $task = $this->resolve($caller, $contentRepositoryId, $workspaceName);
        if (!$task instanceof Model\TaskWorkspace) {
            return $task;
        }
        $text = trim($newComment->text);
        if ($text === '') {
            return UnprocessableContent::because('The comment must not be empty');
        }
        $comment = $this->taskWorkspaceService->commentOnTask($contentRepositoryId->toContentRepositoryId(), $task->workspaceName, $user->getId(), $text);
        return new TaskCommentCreated($this->comment($comment));
    }

    /**
     * The task in the content repository, the same 404 for one the caller may
     * not read as for an unknown one (and an unknown content repository), so
     * tasks can't be probed
     */
    private function resolve(ApiCaller $caller, ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): Model\TaskWorkspace|NotFound
    {
        $contentRepository = $this->studioCallers->contentRepository($contentRepositoryId);
        if (!$contentRepository instanceof ContentRepository) {
            return $contentRepository;
        }
        $name = $workspaceName->toWorkspaceName();
        $task = $this->taskWorkspaceService->getTask($contentRepository->id, $name);
        if ($task === null || !$this->studioCallers->permissionsOf($caller, $contentRepository->id, $name)->read) {
            return NotFound::because(sprintf('There is no task with the workspace %s in the content repository %s', $workspaceName->value, $contentRepositoryId->value));
        }
        return $task;
    }

    private function resolveManageable(ApiCaller $caller, ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): Model\TaskWorkspace|NotFound|Forbidden
    {
        $task = $this->resolve($caller, $contentRepositoryId, $workspaceName);
        if ($task instanceof Model\TaskWorkspace && !$this->studioCallers->permissionsOf($caller, $contentRepositoryId->toContentRepositoryId(), $task->workspaceName)->manage) {
            return Forbidden::because(sprintf('Only the managers of the workspace %s may do this: the task\'s creator and the reviewers', $workspaceName->value));
        }
        return $task;
    }

    private function resolveWritable(ApiCaller $caller, ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): Model\TaskWorkspace|NotFound|Forbidden
    {
        $task = $this->resolve($caller, $contentRepositoryId, $workspaceName);
        if ($task instanceof Model\TaskWorkspace && !$this->studioCallers->permissionsOf($caller, $contentRepositoryId->toContentRepositoryId(), $task->workspaceName)->write) {
            return Forbidden::because(sprintf('You may not write in the workspace %s', $workspaceName->value));
        }
        return $task;
    }

    private function assigneeOf(?UserId $userId): \Neos\Neos\Domain\Model\UserId|UnprocessableContent|null
    {
        if ($userId === null) {
            return null;
        }
        $user = $this->userService->findUserById(\Neos\Neos\Domain\Model\UserId::fromString($userId->value));
        return $user?->getId() ?? UnprocessableContent::because(sprintf('There is no user with the ID %s', $userId->value));
    }

    /**
     * The task as it is now, after a change, in the content repository the
     * operation resolved already
     */
    private function reread(ApiCaller $caller, ContentRepositoryId $contentRepositoryId, SharedModel\Workspace\WorkspaceName $workspaceName): Task
    {
        $contentRepository = $this->studioCallers->contentRepository($contentRepositoryId);
        $task = $contentRepository instanceof ContentRepository ? $this->taskWorkspaceService->getTask($contentRepository->id, $workspaceName) : null;
        if ($task === null) {
            throw new \RuntimeException(sprintf('The task %s is gone', $workspaceName->value), 1792500001);
        }
        return $this->task($caller, $contentRepository, $task, $this->taskWorkspaceService->countComments($contentRepository->id, $workspaceName));
    }

    private function task(ApiCaller $caller, ContentRepository $contentRepository, Model\TaskWorkspace $task, int $commentCount): Task
    {
        // null for a workspace that was just removed while its task record waits for the catch-up hook
        $workspace = $contentRepository->findWorkspaceByName($task->workspaceName);
        return Task::from(
            $task,
            $commentCount,
            $workspace !== null ? $this->studioCallers->workspaceFor($caller, $contentRepository->id, $workspace) : null,
            $workspace !== null && $this->studioCallers->mayPublish($caller, $contentRepository->id, $workspace),
        );
    }

    private function comment(Model\TaskComment $comment): TaskComment
    {
        return TaskComment::from(
            $comment,
            $comment->authorUserId !== null ? $this->userService->findUserById($comment->authorUserId)?->getLabel() : null,
        );
    }
}
