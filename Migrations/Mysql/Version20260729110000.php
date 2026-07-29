<?php
declare(strict_types=1);

namespace Neos\Flow\Persistence\Doctrine\Migrations;

use Doctrine\DBAL\Platforms\AbstractMySQLPlatform;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Create the sidecar table for task workspace metadata
 */
final class Version20260729110000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create the sidecar table for task workspace metadata';
    }

    public function up(Schema $schema): void
    {
        $this->abortIf(
            !$this->connection->getDatabasePlatform() instanceof AbstractMySQLPlatform,
            "Migration can only be executed safely on 'Doctrine\DBAL\Platforms\AbstractMySQLPlatform'."
        );

        $table = $schema->createTable('medienreaktor_neostaskworkflow_task');
        $table->addColumn('content_repository_id', 'string', ['length' => 16]);
        $table->addColumn('workspace_name', 'string', ['length' => 255]);
        $table->addColumn('task_type', 'string', ['length' => 20]);
        $table->addColumn('status', 'string', ['length' => 20]);
        $table->addColumn('assignee_user_id', 'string', ['length' => 255, 'notnull' => false]);
        $table->addColumn('created_by_user_id', 'string', ['length' => 255, 'notnull' => false]);
        $table->addColumn('ticket_reference', 'string', ['length' => 255, 'notnull' => false]);
        $table->addColumn('due_date', 'datetime', ['notnull' => false]);
        $table->addColumn('created_at', 'datetime');
        $table->setPrimaryKey(['content_repository_id', 'workspace_name']);
        $table->addIndex(['assignee_user_id'], 'idx_taskworkflow_assignee');
    }

    public function down(Schema $schema): void
    {
        $schema->dropTable('medienreaktor_neostaskworkflow_task');
    }
}
