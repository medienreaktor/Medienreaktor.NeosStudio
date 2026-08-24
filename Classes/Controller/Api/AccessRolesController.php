<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Controller\Api;

use Medienreaktor\NeosApi\Controller\Api\AbstractApiController;
use Medienreaktor\NeosStudio\Domain\Model\AccessRole;
use Medienreaktor\NeosStudio\Domain\Model\AccessRoleConstraints;
use Medienreaktor\NeosStudio\Domain\Repository\AccessRoleRepository;
use Medienreaktor\NeosStudio\Service\AccessControlService;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\Utility\Algorithms;
use Neos\Neos\Domain\Model\UserId;
use Neos\Neos\Domain\Service\UserService;

/**
 * Administration of the dynamic access roles (see
 * {@see \Medienreaktor\NeosStudio\Domain\Model\AccessRole}) plus the one
 * endpoint every editor needs: their own effective access.
 *
 * Authorization is split by operation in Policy.yaml, mirroring the user
 * administration: reading and writing roles is administrators only
 * (Api.AccessRoles.Read / .Write), while /access/me is granted to every
 * editor - it only ever describes the caller's own restrictions, which they
 * are already living inside.
 *
 * A guard worth naming: an administrator cannot restrict themselves here.
 * Bypass-role holders are exempt from access control by design, so putting
 * one in a role would produce a member who visibly has a role and invisibly
 * ignores it - confusing rather than dangerous, and refused outright.
 */
class AccessRolesController extends AbstractApiController
{
    #[Flow\Inject]
    protected AccessRoleRepository $accessRoleRepository;

    #[Flow\Inject]
    protected AccessControlService $accessControlService;

    #[Flow\Inject]
    protected UserService $userService;

    /**
     * GET /api/access/roles - every role with its members.
     */
    public function indexAction(): string
    {
        $this->requireScope('neos.read');

        $membersByRole = $this->accessRoleRepository->findAllMemberUserIds();
        $roles = array_map(
            static fn (AccessRole $role) => $role->toArray($membersByRole[$role->id] ?? []),
            $this->accessRoleRepository->findAll()
        );

        return $this->json([
            'roles' => $roles,
            'capabilities' => AccessRoleConstraints::CAPABILITIES,
            // Members holding one of these are exempt from access control -
            // the UI marks them so nobody wonders why a role has no effect.
            'bypassRoles' => $this->accessControlService->bypassRoles(),
            'enforcedInContentRepository' => $this->accessControlService->isEnforcedInContentRepository(),
        ]);
    }

    /**
     * POST /api/access/roles - body: {"label": "...", "description"?, "identifier"?,
     * "constraints"?, "memberUserIds"?, "active"?}. A new role restricts
     * nothing until its constraints say otherwise.
     *
     * @param array<string, mixed>|null $constraints
     * @param array<int, string>|null $memberUserIds
     */
    #[Flow\SkipCsrfProtection]
    public function createAction(
        string $label,
        ?string $description = null,
        ?string $identifier = null,
        ?array $constraints = null,
        ?array $memberUserIds = null,
        bool $active = true
    ): string {
        $this->requireScope('neos.write');

        $label = trim($label);
        if ($label === '') {
            $this->throwJsonStatus(400, 'invalid_label', 'The role label must not be empty.');
        }

        $identifier = $identifier !== null && trim($identifier) !== ''
            ? AccessRole::identifierFromLabel($identifier)
            : AccessRole::identifierFromLabel($label);
        if ($this->accessRoleRepository->findByIdentifier($identifier) !== null) {
            $this->throwJsonStatus(409, 'role_exists', sprintf('An access role with the identifier "%s" already exists.', $identifier));
        }

        $memberUserIds = $this->validateMembers($memberUserIds ?? []);

        $now = new \DateTimeImmutable();
        $role = new AccessRole(
            Algorithms::generateUUID(),
            $identifier,
            $label,
            trim($description ?? ''),
            $constraints !== null ? AccessRoleConstraints::fromArray($constraints) : AccessRoleConstraints::unrestricted(),
            $active,
            $now,
            $now,
        );

        $this->accessRoleRepository->add($role);
        $this->accessRoleRepository->setMembers($role->id, $memberUserIds);

        return $this->json(['role' => $role->toArray($memberUserIds)], 201);
    }

    /**
     * PATCH /api/access/roles/{roleId} - partial update; absent keys are left
     * as-is. "constraints" replaces the whole restriction set (it is edited as
     * a whole in the UI), "memberUserIds" replaces the membership.
     *
     * @param array<string, mixed>|null $constraints
     * @param array<int, string>|null $memberUserIds
     */
    #[Flow\SkipCsrfProtection]
    public function updateAction(
        string $roleId,
        ?string $label = null,
        ?string $description = null,
        ?array $constraints = null,
        ?array $memberUserIds = null,
        ?bool $active = null
    ): string {
        $this->requireScope('neos.write');

        $role = $this->requireRole($roleId);

        if ($label !== null && trim($label) === '') {
            $this->throwJsonStatus(400, 'invalid_label', 'The role label must not be empty.');
        }
        $members = $memberUserIds !== null
            ? $this->validateMembers($memberUserIds)
            : $this->accessRoleRepository->findMemberUserIds($role->id);

        $updated = new AccessRole(
            $role->id,
            $role->identifier,
            $label !== null ? trim($label) : $role->label,
            $description !== null ? trim($description) : $role->description,
            $constraints !== null ? AccessRoleConstraints::fromArray($constraints) : $role->constraints,
            $active ?? $role->active,
            $role->createdAt,
            new \DateTimeImmutable(),
        );

        $this->accessRoleRepository->update($updated);
        if ($memberUserIds !== null) {
            $this->accessRoleRepository->setMembers($updated->id, $members);
        }

        return $this->json(['role' => $updated->toArray($members)]);
    }

    /**
     * PUT /api/access/roles/{roleId}/members - body: {"userIds": [...]}.
     * The membership as a whole, which is how the UI edits it.
     *
     * @param array<int, string> $userIds
     */
    #[Flow\SkipCsrfProtection]
    public function setMembersAction(string $roleId, array $userIds): string
    {
        $this->requireScope('neos.write');

        $role = $this->requireRole($roleId);
        $members = $this->validateMembers($userIds);
        $this->accessRoleRepository->setMembers($role->id, $members);

        return $this->json(['role' => $role->toArray($members)]);
    }

    /**
     * DELETE /api/access/roles/{roleId} - removes the role and every
     * membership in it. Members simply stop being restricted by it.
     */
    #[Flow\SkipCsrfProtection]
    public function deleteAction(string $roleId): string
    {
        $this->requireScope('neos.write');

        $role = $this->requireRole($roleId);
        $this->accessRoleRepository->remove($role->id);

        return $this->json(['success' => true]);
    }

    /**
     * GET /api/access/me - the caller's own effective access, in the shape the
     * Studio shell re-evaluates client-side to shape its UI. Granted to every
     * editor: it describes the restrictions they are already living inside.
     */
    public function meAction(): string
    {
        $this->requireScope('neos.read');

        return $this->json([
            'access' => $this->accessControlService->effectiveAccessForCurrentUser()->toArray(),
            'capabilities' => AccessRoleConstraints::CAPABILITIES,
        ]);
    }

    /**
     * Existing, non-bypass users only. A bypass-role holder inside a role
     * would be a member the role provably has no effect on.
     *
     * @param array<int, mixed> $userIds
     * @return array<int, string>
     */
    private function validateMembers(array $userIds): array
    {
        $bypassRoles = $this->accessControlService->bypassRoles();
        $validated = [];
        foreach ($userIds as $userId) {
            if (!is_string($userId) || trim($userId) === '') {
                $this->throwJsonStatus(400, 'invalid_member', 'Member user ids must be non-empty strings.');
            }
            try {
                $user = $this->userService->findUserById(UserId::fromString($userId));
            } catch (\InvalidArgumentException) {
                $this->throwJsonStatus(400, 'invalid_member', sprintf('"%s" is not a valid user id.', $userId));
            }
            if ($user === null) {
                $this->throwJsonStatus(400, 'unknown_member', sprintf('There is no user with the id "%s".', $userId));
            }
            foreach ($this->userService->getAllRoles($user) as $role) {
                if (in_array($role->getIdentifier(), $bypassRoles, true)) {
                    $this->throwJsonStatus(400, 'member_bypasses_access_control', sprintf('"%s" holds the role "%s", which is exempt from access control - the access role would have no effect.', $user->getLabel(), $role->getIdentifier()));
                }
            }
            $validated[] = $userId;
        }

        return array_values(array_unique($validated));
    }

    private function requireRole(string $roleId): AccessRole
    {
        $role = $this->accessRoleRepository->findById($roleId);
        if ($role === null) {
            $this->throwJsonStatus(404, 'role_not_found', 'No such access role.');
        }

        return $role;
    }
}
