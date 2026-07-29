<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Domain\Model;

use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\Neos\Domain\Model\UserId;

/**
 * One comment on a task workspace - part of the task's sidecar data (like
 * {@see TaskWorkspace}), living and dying with the workspace.
 */
final readonly class TaskComment
{
    public function __construct(
        /** Database id; null until persisted. */
        public ?int $id,
        public WorkspaceName $workspaceName,
        public ?UserId $authorUserId,
        public string $text,
        public \DateTimeImmutable $createdAt,
    ) {
    }
}
