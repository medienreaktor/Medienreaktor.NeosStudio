<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\CatchUpHook;


use Medienreaktor\NeosStudio\Domain\Repository\TaskWorkspaceRepository;
use Medienreaktor\NeosStudio\Service\NotificationService;
use Neos\ContentRepository\Core\Projection\CatchUpHook\CatchUpHookFactoryDependencies;
use Neos\ContentRepository\Core\Projection\CatchUpHook\CatchUpHookFactoryInterface;
use Neos\ContentRepository\Core\Projection\ContentGraph\ContentGraphReadModelInterface;
use Neos\Neos\Domain\Service\WorkspaceService;

/**
 * Registered on the content graph projection in Settings.yaml
 * (Neos.ContentRepositoryRegistry.presets.*.contentGraphProjection.catchUpHooks).
 *
 * @implements CatchUpHookFactoryInterface<ContentGraphReadModelInterface>
 */
class TaskWorkspaceLifecycleHookFactory implements CatchUpHookFactoryInterface
{
    public function __construct(
        private readonly TaskWorkspaceRepository $taskWorkspaceRepository,
        private readonly NotificationService $notificationService,
        private readonly WorkspaceService $workspaceService,
    ) {
    }

    public function build(CatchUpHookFactoryDependencies $dependencies): TaskWorkspaceLifecycleHook
    {
        return new TaskWorkspaceLifecycleHook(
            $dependencies->contentRepositoryId,
            $this->taskWorkspaceRepository,
            $this->notificationService,
            $this->workspaceService,
        );
    }
}
