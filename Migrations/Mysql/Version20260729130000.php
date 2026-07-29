<?php
declare(strict_types=1);

namespace Neos\Flow\Persistence\Doctrine\Migrations;

use Doctrine\DBAL\Platforms\AbstractMySQLPlatform;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Drop the task type column - there is only one kind of task workspace
 */
final class Version20260729130000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Drop the task type column - there is only one kind of task workspace';
    }

    public function up(Schema $schema): void
    {
        $this->abortIf(
            !$this->connection->getDatabasePlatform() instanceof AbstractMySQLPlatform,
            "Migration can only be executed safely on 'Doctrine\DBAL\Platforms\AbstractMySQLPlatform'."
        );

        $this->addSql('ALTER TABLE medienreaktor_neosstudio_task DROP COLUMN task_type');
    }

    public function down(Schema $schema): void
    {
        $this->addSql("ALTER TABLE medienreaktor_neosstudio_task ADD task_type VARCHAR(20) NOT NULL DEFAULT 'TASK' AFTER workspace_name");
    }
}
