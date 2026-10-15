<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\AccessRoles;

use Medienreaktor\NeosStudio\Domain\Model;
use Medienreaktor\NeosStudio\Domain\Repository\AccessRoleRepository;
use Medienreaktor\NeosStudio\Endpoint\AccessRoles\RequestBody\AccessRoleCreate;
use Medienreaktor\NeosStudio\Endpoint\AccessRoles\RequestBody\AccessRoleMembersSet;
use Medienreaktor\NeosStudio\Endpoint\AccessRoles\RequestBody\AccessRoleUpdate;
use Medienreaktor\NeosStudio\Endpoint\AccessRoles\Response\AccessRoleCreated;
use Medienreaktor\NeosStudio\Endpoint\AccessRoles\Schema\AccessCapabilityList;
use Medienreaktor\NeosStudio\Endpoint\AccessRoles\Schema\AccessRole;
use Medienreaktor\NeosStudio\Endpoint\AccessRoles\Schema\AccessRoleId;
use Medienreaktor\NeosStudio\Endpoint\AccessRoles\Schema\AccessRoleList;
use Medienreaktor\NeosStudio\Endpoint\AccessRoles\Schema\AccessRoleListing;
use Medienreaktor\NeosStudio\Endpoint\AccessRoles\Schema\AccessRoleListingMeta;
use Medienreaktor\NeosStudio\Security\StudioScopes;
use Medienreaktor\NeosStudio\Service\AccessControlService;
use Neos\Api\Security\ApiAuthContextProvider;
use Neos\Api\Shared\Response\Conflict;
use Neos\Api\Shared\Response\NotFound;
use Neos\Api\Shared\Response\UnprocessableContent;
use Neos\Flow\Utility\Algorithms;
use Neos\Neos\Domain\Model\UserId;
use Neos\Neos\Domain\Service\UserService;
use Neos\OpenApi\Attributes\Operation;
use Neos\OpenApi\Attributes\RequestBody;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The access roles: named sets of constraints (sites, page tree, dimension
 * values, workspaces, capabilities) and the Neos users they apply to
 *
 * Administration, for administrators as the Neos users module is. A role only
 * ever narrows down what its members' Neos roles allow; users holding a bypass
 * role (administrators by default) can't be members, a role would have no
 * effect on them. What a user's roles leave open is getMyAccess.
 */
final readonly class AccessRoles
{
    public function __construct(
        private AccessRoleRepository $accessRoleRepository,
        private AccessControlService $accessControlService,
        private UserService $userService,
    ) {
    }

    #[Operation(
        path: '/accessroles',
        method: 'GET',
        summary: 'List the access roles',
        description: 'All access roles with their members, by label. meta has the capabilities a role can withhold, the Neos roles exempt from access roles and whether the content repository enforces them.',
        operationId: 'listAccessRoles',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::ACCESSROLES_READ],
        ],
    )]
    public function list(): AccessRoleListing
    {
        $membersByRole = $this->accessRoleRepository->findAllMemberUserIds();
        $roles = array_map(
            static fn (Model\AccessRole $role) => AccessRole::from($role, $membersByRole[$role->id] ?? []),
            $this->accessRoleRepository->findAll(),
        );
        return new AccessRoleListing(
            new AccessRoleList(...$roles),
            new AccessRoleListingMeta(
                count($roles),
                AccessCapabilityList::all(),
                $this->accessControlService->bypassRoles(),
                $this->accessControlService->isEnforcedInContentRepository(),
            ),
        );
    }

    #[Operation(
        path: '/accessroles',
        method: 'POST',
        summary: 'Create an access role',
        description: 'An identifier that is taken is a 409, a member that doesn\'t exist or holds a bypass role a 422.',
        operationId: 'createAccessRole',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::ACCESSROLES_UPDATE],
        ],
    )]
    public function create(
        #[RequestBody(description: 'The new access role')] AccessRoleCreate $newAccessRole,
        ServerRequestInterface $request,
    ): AccessRoleCreated|Conflict|UnprocessableContent {
        // AccessRoleCreate only validated the body, maps schematic can't build
        $values = self::body($request);
        $label = trim((string)$values['label']);
        if ($label === '') {
            return UnprocessableContent::because('The label must not be empty');
        }
        $identifier = Model\AccessRole::identifierFromLabel(
            isset($values['identifier']) && trim((string)$values['identifier']) !== '' ? (string)$values['identifier'] : $label,
        );
        if ($this->accessRoleRepository->findByIdentifier($identifier) !== null) {
            return Conflict::because(sprintf('There is an access role with the identifier %s already', $identifier));
        }
        $members = $this->members($values['memberUserIds'] ?? []);
        if ($members instanceof UnprocessableContent) {
            return $members;
        }
        $now = new \DateTimeImmutable();
        $role = new Model\AccessRole(
            Algorithms::generateUUID(),
            $identifier,
            $label,
            trim((string)($values['description'] ?? '')),
            isset($values['constraints']) ? Model\AccessRoleConstraints::fromArray($values['constraints']) : Model\AccessRoleConstraints::unrestricted(),
            (bool)($values['active'] ?? true),
            $now,
            $now,
        );
        $this->accessRoleRepository->add($role);
        $this->accessRoleRepository->setMembers($role->id, $members);
        return new AccessRoleCreated(AccessRole::from($role, $members));
    }

    #[Operation(
        path: '/accessroles/{accessRoleId}',
        method: 'GET',
        summary: 'Get an access role',
        description: 'The access role with its members.',
        operationId: 'getAccessRole',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::ACCESSROLES_READ],
        ],
    )]
    public function get(AccessRoleId $accessRoleId): AccessRole|NotFound
    {
        $role = $this->resolve($accessRoleId);
        if (!$role instanceof Model\AccessRole) {
            return $role;
        }
        return AccessRole::from($role, $this->accessRoleRepository->findMemberUserIds($role->id));
    }

    #[Operation(
        path: '/accessroles/{accessRoleId}',
        method: 'PATCH',
        summary: 'Update an access role',
        description: 'Changes what is given, constraints and memberUserIds as a whole. A member that doesn\'t exist or holds a bypass role is a 422.',
        operationId: 'updateAccessRole',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::ACCESSROLES_UPDATE],
        ],
    )]
    public function update(
        AccessRoleId $accessRoleId,
        #[RequestBody(description: 'The changes, what is left out stays as it is')] AccessRoleUpdate $changes,
        ServerRequestInterface $request,
    ): AccessRole|NotFound|UnprocessableContent {
        $role = $this->resolve($accessRoleId);
        if (!$role instanceof Model\AccessRole) {
            return $role;
        }
        // AccessRoleUpdate only validated the body, maps schematic can't build
        $values = self::body($request);
        if (isset($values['label']) && trim((string)$values['label']) === '') {
            return UnprocessableContent::because('The label must not be empty');
        }
        $members = isset($values['memberUserIds'])
            ? $this->members($values['memberUserIds'])
            : $this->accessRoleRepository->findMemberUserIds($role->id);
        if ($members instanceof UnprocessableContent) {
            return $members;
        }
        $updated = new Model\AccessRole(
            $role->id,
            $role->identifier,
            isset($values['label']) ? trim((string)$values['label']) : $role->label,
            isset($values['description']) ? trim((string)$values['description']) : $role->description,
            isset($values['constraints']) ? Model\AccessRoleConstraints::fromArray($values['constraints']) : $role->constraints,
            isset($values['active']) ? (bool)$values['active'] : $role->active,
            $role->createdAt,
            new \DateTimeImmutable(),
        );
        $this->accessRoleRepository->update($updated);
        if (isset($values['memberUserIds'])) {
            $this->accessRoleRepository->setMembers($updated->id, $members);
        }
        return AccessRole::from($updated, $members);
    }

    #[Operation(
        path: '/accessroles/{accessRoleId}/members',
        method: 'PUT',
        summary: 'Set the members of an access role',
        description: 'Replaces the members. A user that doesn\'t exist or holds a bypass role is a 422.',
        operationId: 'setAccessRoleMembers',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::ACCESSROLES_UPDATE],
        ],
    )]
    public function setMembers(
        AccessRoleId $accessRoleId,
        #[RequestBody(description: 'The members')] AccessRoleMembersSet $members,
    ): AccessRole|NotFound|UnprocessableContent {
        $role = $this->resolve($accessRoleId);
        if (!$role instanceof Model\AccessRole) {
            return $role;
        }
        $userIds = $this->members($members->userIds);
        if ($userIds instanceof UnprocessableContent) {
            return $userIds;
        }
        $this->accessRoleRepository->setMembers($role->id, $userIds);
        return AccessRole::from($role, $userIds);
    }

    #[Operation(
        path: '/accessroles/{accessRoleId}',
        method: 'DELETE',
        summary: 'Delete an access role',
        description: 'Its members simply aren\'t restricted by it any more.',
        operationId: 'deleteAccessRole',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::ACCESSROLES_UPDATE],
        ],
    )]
    public function delete(AccessRoleId $accessRoleId): NotFound|null
    {
        $role = $this->resolve($accessRoleId);
        if (!$role instanceof Model\AccessRole) {
            return $role;
        }
        $this->accessRoleRepository->remove($role->id);
        return null;
    }

    private function resolve(AccessRoleId $accessRoleId): Model\AccessRole|NotFound
    {
        return $this->accessRoleRepository->findById($accessRoleId->value)
            ?? NotFound::because(sprintf('There is no access role with the ID %s', $accessRoleId->value));
    }

    /**
     * Existing users without a bypass role: a role would have no effect on
     * those
     *
     * @param mixed $userIds the user IDs, validated by the body's schema
     * @return list<string>|UnprocessableContent
     */
    private function members(mixed $userIds): array|UnprocessableContent
    {
        $bypassRoles = $this->accessControlService->bypassRoles();
        $members = [];
        foreach (is_array($userIds) ? $userIds : [] as $userId) {
            $user = $this->userService->findUserById(UserId::fromString((string)$userId));
            if ($user === null) {
                return UnprocessableContent::because(sprintf('There is no user with the ID %s', $userId));
            }
            foreach ($this->userService->getAllRoles($user) as $role) {
                if (in_array($role->getIdentifier(), $bypassRoles, true)) {
                    return UnprocessableContent::because(sprintf('%s has the role %s, which access roles don\'t apply to', $user->getLabel(), $role->getIdentifier()));
                }
            }
            $members[] = (string)$userId;
        }
        return array_values(array_unique($members));
    }

    /**
     * @return array<string, mixed>
     */
    private static function body(ServerRequestInterface $request): array
    {
        $body = $request->getBody();
        if ($body->isSeekable()) {
            $body->rewind();
        }
        $values = json_decode($body->getContents(), true, flags: JSON_THROW_ON_ERROR);
        return is_array($values) ? $values : [];
    }
}
