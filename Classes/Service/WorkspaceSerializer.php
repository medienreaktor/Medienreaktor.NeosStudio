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
 * Studio's own endpoints embed (e.g. in a task) - in the shape of Neos.Api's
 * Workspace schema, so the shell handles one workspace model for both APIs.
 *
 * Permissions are computed once per workspace and remembered for the request.
 */
#[Flow\Scope('singleton')]
class WorkspaceSerializer
{
    #[Flow\Inject]
    protected ContentRepositoryAuthorizationService $authorizationService;

    #[Flow\Inject]
    protected WorkspaceService $workspaceService;

    #[Flow\Inject]
    protected UserService $userService;

    #[Flow\Inject]
    protected SecurityContext $securityContext;

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
     * Whether the account may publish the workspace: publishing writes to the
     * base workspace - the check the content repository applies to
     * PublishWorkspace.
     */
    public function canPublish(ContentRepositoryId $contentRepositoryId, Workspace $workspace): bool
    {
        return $workspace->baseWorkspaceName !== null
            && $this->permissions($contentRepositoryId, $workspace->baseWorkspaceName)->write;
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

        return [
            'name' => $workspace->workspaceName->value,
            'baseWorkspaceName' => $workspace->baseWorkspaceName?->value,
            'title' => $metadata->title->value,
            'description' => $metadata->description->value,
            'classification' => strtolower($metadata->classification->value),
            'ownerId' => $metadata->ownerUserId?->value,
            'status' => strtolower($workspace->status->value),
            'hasPublishableChanges' => $workspace->hasPublishableChanges(),
            'permissions' => [
                'read' => $permissions->read,
                'write' => $permissions->write,
                'manage' => $permissions->manage,
            ],
        ];
    }
}
