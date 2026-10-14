<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

use Medienreaktor\NeosStudio\Domain\Model\TaskWorkspace;
use Medienreaktor\NeosStudio\Domain\Repository\TaskWorkspaceRepository;
use Neos\ContentRepository\Core\SharedModel\ContentRepository\ContentRepositoryId;
use Neos\ContentRepository\Core\SharedModel\Workspace\Workspace;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\Model\UserId;
use Neos\Neos\Domain\Service\UserService;

/**
 * The task metadata of a workspace, as the Studio's WorkspaceSerializer
 * embeds it under workspace.extensions['Medienreaktor.NeosStudio:task'] (the
 * workspaces the task endpoints return). Workspaces read from Neos.Api carry
 * no extensions; the shell joins them with the task list by workspace name.
 *
 * Runs for every serialized workspace, so the task list is loaded once per
 * content repository and request, not per workspace.
 */
#[Flow\Scope('singleton')]
final class TaskWorkspaceDataEnricher
{
    #[Flow\Inject]
    protected TaskWorkspaceRepository $taskWorkspaceRepository;

    #[Flow\Inject]
    protected UserService $userService;

    /**
     * @var array<string, array<string, TaskWorkspace>>
     */
    private array $tasksByContentRepository = [];

    /**
     * @var array<string, string|null>
     */
    private array $userLabels = [];

    /**
     * @return array<string, mixed>|null null if the workspace is no task
     */
    public function enrich(ContentRepositoryId $contentRepositoryId, Workspace $workspace): ?array
    {
        $this->tasksByContentRepository[$contentRepositoryId->value]
            ??= $this->taskWorkspaceRepository->findAll($contentRepositoryId);

        $task = $this->tasksByContentRepository[$contentRepositoryId->value][$workspace->workspaceName->value] ?? null;
        if ($task === null) {
            return null;
        }

        return [
            'status' => $task->status->value,
            'assignee' => $task->assigneeUserId?->value,
            'assigneeLabel' => $task->assigneeUserId !== null ? $this->userLabel($task->assigneeUserId) : null,
            'createdBy' => $task->createdByUserId?->value,
            'createdAt' => $task->createdAt->format(\DateTimeInterface::ATOM),
        ];
    }

    private function userLabel(UserId $userId): ?string
    {
        if (!array_key_exists($userId->value, $this->userLabels)) {
            $this->userLabels[$userId->value] = $this->userService->findUserById($userId)?->getLabel();
        }

        return $this->userLabels[$userId->value];
    }
}
