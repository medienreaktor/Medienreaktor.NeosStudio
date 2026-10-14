<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

use Neos\ContentRepository\Core\SharedModel\ContentRepository\ContentRepositoryId;
use Neos\ContentRepository\Core\SharedModel\Workspace\Workspace;
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\Security\Context as SecurityContext;
use Neos\Neos\Domain\Model\WorkspacePermissions;
use Neos\Neos\Domain\Service\UserService;
use Neos\Neos\Domain\Service\WorkspaceService;
use Neos\Neos\Security\Authorization\ContentRepositoryAuthorizationService;

/**
 * The acting account's permissions on workspaces, and the workspace JSON the
 * Studio's own endpoints embed (e.g. in a task). The shape is the shell's
 * internal Workspace type (api/workspaces.ts), which the shell also maps
 * Neos.Api's workspaces onto.
 *
 * Permissions are computed once per workspace and remembered for the request.
 */
#[Flow\Scope('singleton')]
class WorkspaceSerializer
{
    public const TASK_EXTENSION_KEY = 'Medienreaktor.NeosStudio:task';

    #[Flow\Inject]
    protected ContentRepositoryAuthorizationService $authorizationService;

    #[Flow\Inject]
    protected WorkspaceService $workspaceService;

    #[Flow\Inject]
    protected UserService $userService;

    #[Flow\Inject]
    protected SecurityContext $securityContext;

    #[Flow\Inject]
    protected TaskWorkspaceDataEnricher $taskWorkspaceDataEnricher;

    /**
     * @var array<string, WorkspacePermissions>
     */
    private array $permissionsCache = [];

    public function permissions(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): WorkspacePermissions
    {
        return $this->permissionsCache[$contentRepositoryId->value . ':' . $workspaceName->value] ??= $this->authorizationService->getWorkspacePermissions(
            $contentRepositoryId,
            $workspaceName,
            $this->securityContext->getRoles(),
            $this->userService->getCurrentUser()?->getId()
        );
    }

    public function canRead(ContentRepositoryId $contentRepositoryId, WorkspaceName $workspaceName): bool
    {
        return $this->permissions($contentRepositoryId, $workspaceName)->read;
    }

    /**
     * @return array<string, mixed>|null null if the account may not read the workspace
     */
    public function serialize(ContentRepositoryId $contentRepositoryId, Workspace $workspace): ?array
    {
        $permissions = $this->permissions($contentRepositoryId, $workspace->workspaceName);
        if (!$permissions->read) {
            return null;
        }

        $metadata = $this->workspaceService->getWorkspaceMetadata($contentRepositoryId, $workspace->workspaceName);
        $task = $this->taskWorkspaceDataEnricher->enrich($contentRepositoryId, $workspace);

        return [
            'name' => $workspace->workspaceName->value,
            'baseWorkspace' => $workspace->baseWorkspaceName?->value,
            'title' => $metadata->title->value,
            'description' => $metadata->description->value,
            'classification' => $metadata->classification->value,
            'owner' => $metadata->ownerUserId?->value,
            'hasPublishableChanges' => $workspace->hasPublishableChanges(),
            'status' => $workspace->status->value,
            'permissions' => [
                'read' => $permissions->read,
                'write' => $permissions->write,
                'manage' => $permissions->manage,
                // Publishing means writing to the base workspace - the same
                // check the content repository applies to PublishWorkspace.
                'publish' => $workspace->baseWorkspaceName !== null
                    && $this->permissions($contentRepositoryId, $workspace->baseWorkspaceName)->write,
            ],
            'extensions' => $task === null ? new \stdClass() : [self::TASK_EXTENSION_KEY => $task],
        ];
    }
}
