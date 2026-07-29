<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Domain\Model;

use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\Model\UserId;

/**
 * The task metadata attached to one content repository workspace - the
 * package's sidecar record. A workspace "is" a task workspace exactly when
 * such a record exists for it; to the Neos core it remains an ordinary
 * SHARED workspace.
 */
#[Flow\Proxy(false)]
final readonly class TaskWorkspace
{
    public function __construct(
        public WorkspaceName $workspaceName,
        public TaskStatus $status,
        public ?UserId $assigneeUserId,
        public ?UserId $createdByUserId,
        public \DateTimeImmutable $createdAt,
    ) {
    }
}
