<?php
declare(strict_types=1);

namespace Neos\Flow\Persistence\Doctrine\Migrations;

use Doctrine\DBAL\Platforms\AbstractMySQLPlatform;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Create the tables for dynamic access roles and their member assignments
 */
final class Version20260824120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create the tables for dynamic access roles and their member assignments';
    }

    public function up(Schema $schema): void
    {
        $this->abortIf(
            !$this->connection->getDatabasePlatform() instanceof AbstractMySQLPlatform,
            "Migration can only be executed safely on 'Doctrine\DBAL\Platforms\AbstractMySQLPlatform'."
        );

        $roles = $schema->createTable('medienreaktor_neosstudio_accessrole');
        $roles->addColumn('id', 'string', ['length' => 36]);
        // URL-safe handle, unique - the stable reference for scripts/imports.
        $roles->addColumn('identifier', 'string', ['length' => 255]);
        $roles->addColumn('label', 'string', ['length' => 255]);
        $roles->addColumn('description', 'text', ['notnull' => false]);
        // The whole restriction set (sites, page tree, dimensions, workspaces,
        // capabilities). Schemaless on purpose: the shape evolves with the UI
        // and is only ever read as a whole, never queried into.
        $roles->addColumn('constraints', 'json');
        $roles->addColumn('active', 'boolean', ['default' => true]);
        $roles->addColumn('created_at', 'datetime');
        $roles->addColumn('updated_at', 'datetime');
        $roles->setPrimaryKey(['id']);
        $roles->addUniqueIndex(['identifier'], 'uniq_accessrole_identifier');

        $members = $schema->createTable('medienreaktor_neosstudio_accessrolemember');
        $members->addColumn('role_id', 'string', ['length' => 36]);
        // The Neos UserId - not a foreign key, users live in their own
        // Doctrine-managed schema and are deleted through the user service.
        $members->addColumn('user_id', 'string', ['length' => 255]);
        $members->setPrimaryKey(['role_id', 'user_id']);
        $members->addIndex(['user_id'], 'idx_accessrolemember_user');
        $members->addForeignKeyConstraint(
            'medienreaktor_neosstudio_accessrole',
            ['role_id'],
            ['id'],
            ['onDelete' => 'CASCADE'],
            'fk_accessrolemember_role'
        );
    }

    public function down(Schema $schema): void
    {
        $schema->dropTable('medienreaktor_neosstudio_accessrolemember');
        $schema->dropTable('medienreaktor_neosstudio_accessrole');
    }
}
