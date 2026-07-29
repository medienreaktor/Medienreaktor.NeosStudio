<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\CatchUpHook;


use Medienreaktor\NeosStudio\Domain\Model\TaskStatus;
use Medienreaktor\NeosStudio\Service\NotificationService;
use Medienreaktor\NeosStudio\Domain\Repository\TaskCommentRepository;
use Medienreaktor\NeosStudio\Domain\Repository\TaskWorkspaceRepository;
use Medienreaktor\NeosStudio\Service\TaskWorkspaceService;
use Neos\ContentRepository\Core\EventStore\EventInterface;
use Neos\ContentRepository\Core\Feature\WorkspaceModification\Event\WorkspaceWasRemoved;
use Neos\ContentRepository\Core\Feature\WorkspacePublication\Event\WorkspaceWasPublished;
use Neos\ContentRepository\Core\Projection\CatchUpHook\CatchUpHookInterface;
use Neos\ContentRepository\Core\SharedModel\ContentRepository\ContentRepositoryId;
use Neos\ContentRepository\Core\Subscription\SubscriptionStatus;
use Neos\EventStore\Model\EventEnvelope;
use Neos\Neos\Domain\Model\UserId;
use Neos\Neos\Domain\Service\WorkspaceService;

/**
 * Reacts to workspace lifecycle events for task workspaces:
 *
 *  - a task workspace was (fully) published -> the task is DONE, creator and
 *    assignee get notified. Because this reacts to the event (not to our own
 *    service call), publishes through the Workspace module, the CLI or any
 *    other client complete the task exactly the same way.
 *  - a task workspace was removed -> the sidecar record is cleaned up.
 *
 * Events are only *collected* during the catch-up (onAfterEvent runs inside
 * the projection's transaction); all side effects run in onAfterCatchUp,
 * after the transaction committed - a rolled-back catch-up must not have
 * sent notifications.
 */
final class TaskWorkspaceLifecycleHook implements CatchUpHookInterface
{
    /**
     * @var array<int, array{event: WorkspaceWasPublished|WorkspaceWasRemoved, initiatingUserId: string|null}>
     */
    private array $pendingEvents = [];

    public function __construct(
        private readonly ContentRepositoryId $contentRepositoryId,
        private readonly TaskWorkspaceRepository $taskWorkspaceRepository,
        private readonly TaskCommentRepository $taskCommentRepository,
        private readonly NotificationService $notificationService,
        private readonly WorkspaceService $workspaceService,
    ) {
    }

    public function onBeforeCatchUp(SubscriptionStatus $subscriptionStatus): void
    {
    }

    public function onBeforeEvent(EventInterface $eventInstance, EventEnvelope $eventEnvelope): void
    {
    }

    public function onAfterEvent(EventInterface $eventInstance, EventEnvelope $eventEnvelope): void
    {
        if (!$eventInstance instanceof WorkspaceWasPublished && !$eventInstance instanceof WorkspaceWasRemoved) {
            return;
        }
        $initiatingUserId = $eventEnvelope->event->metadata?->get('initiatingUserId');
        $this->pendingEvents[] = [
            'event' => $eventInstance,
            'initiatingUserId' => is_string($initiatingUserId) ? $initiatingUserId : null,
        ];
    }

    public function onAfterBatchCompleted(): void
    {
    }

    public function onAfterCatchUp(): void
    {
        $pending = $this->pendingEvents;
        $this->pendingEvents = [];
        $notified = false;

        foreach ($pending as ['event' => $event, 'initiatingUserId' => $initiatingUserId]) {
            if ($event instanceof WorkspaceWasRemoved) {
                $this->taskWorkspaceRepository->remove($this->contentRepositoryId, $event->workspaceName);
                $this->taskCommentRepository->removeForWorkspace($this->contentRepositoryId, $event->workspaceName);
                continue;
            }

            // Partial publishes move single changes along; only a full publish
            // completes the task.
            if ($event->partial) {
                continue;
            }
            $task = $this->taskWorkspaceRepository->findByWorkspaceName($this->contentRepositoryId, $event->sourceWorkspaceName);
            if ($task === null || $task->status === TaskStatus::DONE) {
                continue;
            }

            $this->taskWorkspaceRepository->updateStatus($this->contentRepositoryId, $event->sourceWorkspaceName, TaskStatus::DONE);

            $title = $this->workspaceService->getWorkspaceMetadata($this->contentRepositoryId, $event->sourceWorkspaceName)->title->value;
            $recipients = [];
            foreach ([$task->createdByUserId, $task->assigneeUserId] as $userId) {
                if ($userId !== null && $userId->value !== $initiatingUserId) {
                    $recipients[] = $userId;
                }
            }
            $this->notificationService->notifyUsers(
                $recipients,
                TaskWorkspaceService::NOTIFICATION_SOURCE,
                'taskWorkflow.published',
                sprintf('Published: %s', $title),
                sprintf('The task "%s" has been published to "%s".', $title, $event->targetWorkspaceName->value),
                array_filter([
                    'workspaceName' => $event->sourceWorkspaceName->value,
                ]),
            );
            $notified = ($recipients !== []) || $notified;
        }

        if ($notified) {
            // Catch-ups also run outside a normal request lifecycle (CLI
            // subscription workers); persist explicitly so notifications
            // cannot get lost there.
            $this->notificationService->flush();
        }
    }
}
