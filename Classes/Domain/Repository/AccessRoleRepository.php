<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Domain\Repository;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Exception as DbalException;
use Medienreaktor\NeosStudio\Domain\Model\AccessRole;
use Medienreaktor\NeosStudio\Domain\Model\AccessRoleConstraints;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\Model\UserId;

/**
 * Plain DBAL storage for access roles and their member assignments (same
 * layering as the preview-link and task sidecar tables). No authorization is
 * imposed here - who may edit roles is decided in the controller, what a role
 * means is decided in the AccessControlService.
 *
 * @internal
 */
#[Flow\Scope('singleton')]
final readonly class AccessRoleRepository
{
    private const TABLE_NAME = 'medienreaktor_neosstudio_accessrole';
    private const MEMBER_TABLE_NAME = 'medienreaktor_neosstudio_accessrolemember';

    public function __construct(
        private Connection $dbal,
    ) {
    }

    /**
     * @return array<int, AccessRole>
     */
    public function findAll(): array
    {
        $table = self::TABLE_NAME;
        $rows = $this->dbal->fetchAllAssociative("SELECT * FROM {$table} ORDER BY label ASC");

        return array_map($this->mapRow(...), $rows);
    }

    /**
     * The active roles a user is a member of - the only query on the
     * authorization hot path, so it joins instead of loading all roles.
     *
     * @return array<int, AccessRole>
     */
    public function findActiveByMember(UserId $userId): array
    {
        $table = self::TABLE_NAME;
        $memberTable = self::MEMBER_TABLE_NAME;
        $rows = $this->dbal->fetchAllAssociative(
            "SELECT r.* FROM {$table} r
             INNER JOIN {$memberTable} m ON m.role_id = r.id
             WHERE m.user_id = :userId AND r.active = 1
             ORDER BY r.label ASC",
            ['userId' => $userId->value]
        );

        return array_map($this->mapRow(...), $rows);
    }

    public function findById(string $id): ?AccessRole
    {
        $table = self::TABLE_NAME;
        $row = $this->dbal->fetchAssociative("SELECT * FROM {$table} WHERE id = :id", ['id' => $id]);

        return is_array($row) ? $this->mapRow($row) : null;
    }

    public function findByIdentifier(string $identifier): ?AccessRole
    {
        $table = self::TABLE_NAME;
        $row = $this->dbal->fetchAssociative("SELECT * FROM {$table} WHERE identifier = :identifier", ['identifier' => $identifier]);

        return is_array($row) ? $this->mapRow($row) : null;
    }

    public function add(AccessRole $role): void
    {
        try {
            $this->dbal->insert(self::TABLE_NAME, $this->toColumns($role));
        } catch (DbalException $e) {
            throw new \RuntimeException(sprintf('Failed to add access role "%s": %s', $role->identifier, $e->getMessage()), 1756000010, $e);
        }
    }

    public function update(AccessRole $role): void
    {
        try {
            $this->dbal->update(self::TABLE_NAME, $this->toColumns($role), ['id' => $role->id]);
        } catch (DbalException $e) {
            throw new \RuntimeException(sprintf('Failed to update access role "%s": %s', $role->identifier, $e->getMessage()), 1756000011, $e);
        }
    }

    /** Removes the role and, through the foreign key, its memberships. */
    public function remove(string $id): void
    {
        $this->dbal->delete(self::MEMBER_TABLE_NAME, ['role_id' => $id]);
        $this->dbal->delete(self::TABLE_NAME, ['id' => $id]);
    }

    /**
     * @return array<int, string> user ids
     */
    public function findMemberUserIds(string $roleId): array
    {
        $table = self::MEMBER_TABLE_NAME;

        return $this->dbal->fetchFirstColumn(
            "SELECT user_id FROM {$table} WHERE role_id = :roleId ORDER BY user_id ASC",
            ['roleId' => $roleId]
        );
    }

    /**
     * All memberships at once, so the role listing does not fan out into one
     * query per role.
     *
     * @return array<string, array<int, string>> role id => user ids
     */
    public function findAllMemberUserIds(): array
    {
        $table = self::MEMBER_TABLE_NAME;
        $rows = $this->dbal->fetchAllAssociative("SELECT role_id, user_id FROM {$table} ORDER BY user_id ASC");

        $byRole = [];
        foreach ($rows as $row) {
            $byRole[$row['role_id']][] = $row['user_id'];
        }

        return $byRole;
    }

    /**
     * Replace a role's members wholesale - the shape the administration UI
     * works in ("these people are in this role").
     *
     * @param array<int, string> $userIds
     */
    public function setMembers(string $roleId, array $userIds): void
    {
        $this->dbal->transactional(function (Connection $connection) use ($roleId, $userIds): void {
            $connection->delete(self::MEMBER_TABLE_NAME, ['role_id' => $roleId]);
            foreach (array_unique(array_filter($userIds)) as $userId) {
                $connection->insert(self::MEMBER_TABLE_NAME, [
                    'role_id' => $roleId,
                    'user_id' => $userId,
                ]);
            }
        });
    }

    /** Drops a deleted user from every role they were a member of. */
    public function removeMemberEverywhere(string $userId): void
    {
        $this->dbal->delete(self::MEMBER_TABLE_NAME, ['user_id' => $userId]);
    }

    /**
     * @return array<string, mixed>
     */
    private function toColumns(AccessRole $role): array
    {
        return [
            'id' => $role->id,
            'identifier' => $role->identifier,
            'label' => $role->label,
            'description' => $role->description,
            'constraints' => $role->constraints->toJsonString(),
            'active' => $role->active ? 1 : 0,
            'created_at' => $role->createdAt->format('Y-m-d H:i:s'),
            'updated_at' => $role->updatedAt->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @param array<string, mixed> $row
     */
    private function mapRow(array $row): AccessRole
    {
        return new AccessRole(
            $row['id'],
            $row['identifier'],
            $row['label'],
            (string)($row['description'] ?? ''),
            AccessRoleConstraints::fromJsonString((string)($row['constraints'] ?? '{}')),
            (bool)$row['active'],
            new \DateTimeImmutable($row['created_at']),
            new \DateTimeImmutable($row['updated_at']),
        );
    }
}
