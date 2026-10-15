<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Security;

use Neos\Api\Endpoint\ContentRepositories\Schema\ContentRepositoryId;
use Neos\Api\Endpoint\Workspaces\Domain\WorkspaceResolver;
use Neos\Api\Endpoint\Workspaces\Schema\Workspace;
use Neos\Api\Security\ApiCaller;
use Neos\Api\Shared\Response\Forbidden;
use Neos\Api\Shared\Response\NotFound;
use Neos\ContentRepository\Core\ContentRepository;
use Neos\ContentRepository\Core\SharedModel;
use Neos\ContentRepositoryRegistry\ContentRepositoryRegistry;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\Model;
use Neos\Neos\Domain\Service\WorkspaceService;

/**
 * Who calls a Studio operation, and in which content repository
 *
 * As in Neos.Api, always the token's account (its roles, its Neos user), never
 * Flow's security context: the user behind the token, and what it may do in a
 * workspace (Neos.Api's WorkspaceResolver, remembered for the request).
 */
#[Flow\Scope('singleton')]
final class StudioCallers
{
    /**
     * @var array<string, Model\WorkspacePermissions>
     */
    private array $permissions = [];

    public function __construct(
        private readonly ContentRepositoryRegistry $contentRepositoryRegistry,
        private readonly WorkspaceResolver $workspaceResolver,
        private readonly WorkspaceService $workspaceService,
    ) {
    }

    /**
     * The content repository of the path, or the 404 for an unknown one
     */
    public function contentRepository(ContentRepositoryId $contentRepositoryId): ContentRepository|NotFound
    {
        $id = $contentRepositoryId->toContentRepositoryId();
        foreach ($this->contentRepositoryRegistry->getContentRepositoryIds() as $configuredId) {
            if ($configuredId->equals($id)) {
                return $this->contentRepositoryRegistry->get($id);
            }
        }
        return NotFound::contentRepository($contentRepositoryId->value);
    }

    /**
     * The Neos user of the token's account, null for an account without one
     * (e.g. a machine client's)
     */
    public function userOf(ApiCaller $caller): ?Model\User
    {
        return $this->workspaceResolver->userOf($caller->account);
    }

    /**
     * The Neos user of the token's account, or the 403 for operations that are
     * about the user (their notifications, tasks, preview links)
     */
    public function requireUserOf(ApiCaller $caller): Model\User|Forbidden
    {
        return $this->userOf($caller)
            ?? Forbidden::because('This operation requires an access token of a Neos user');
    }

    public function permissionsOf(ApiCaller $caller, SharedModel\ContentRepository\ContentRepositoryId $contentRepositoryId, SharedModel\Workspace\WorkspaceName $workspaceName): Model\WorkspacePermissions
    {
        return $this->permissions[$caller->account->getAccountIdentifier() . '|' . $contentRepositoryId->value . '|' . $workspaceName->value]
            ??= $this->workspaceResolver->permissionsOf($contentRepositoryId, $workspaceName, $caller->account);
    }

    /**
     * Whether the caller may publish the workspace: publishing writes to the
     * base workspace - the check the content repository applies to
     * PublishWorkspace
     */
    public function mayPublish(ApiCaller $caller, SharedModel\ContentRepository\ContentRepositoryId $contentRepositoryId, SharedModel\Workspace\Workspace $workspace): bool
    {
        return $workspace->baseWorkspaceName !== null
            && $this->permissionsOf($caller, $contentRepositoryId, $workspace->baseWorkspaceName)->write;
    }

    /**
     * The workspace as Neos.Api's getWorkspace has it, null if the caller may
     * not read it
     */
    public function workspaceFor(ApiCaller $caller, SharedModel\ContentRepository\ContentRepositoryId $contentRepositoryId, SharedModel\Workspace\Workspace $workspace): ?Workspace
    {
        $permissions = $this->permissionsOf($caller, $contentRepositoryId, $workspace->workspaceName);
        if (!$permissions->read) {
            return null;
        }
        return Workspace::from(
            $workspace,
            $this->workspaceService->getWorkspaceMetadata($contentRepositoryId, $workspace->workspaceName),
            $permissions,
        );
    }
}
