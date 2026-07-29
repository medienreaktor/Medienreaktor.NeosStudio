<?php
declare(strict_types=1);

namespace Neos\Flow\Persistence\Doctrine\Migrations;

use Doctrine\DBAL\Platforms\AbstractMySQLPlatform;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Comments on task workspaces - a flat sidecar table next to the task
 * metadata, keyed the same way (content repository id + workspace name)
 */
final class Version20260729160000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create the task workspace comment table';
    }

    public function up(Schema $schema): void
    {
        $this->abortIf(
            !$this->connection->getDatabasePlatform() instanceof AbstractMySQLPlatform,
            "Migration can only be executed safely on 'Doctrine\DBAL\Platforms\AbstractMySQLPlatform'."
        );

        $this->addSql(<<<'SQL'
            CREATE TABLE medienreaktor_neosstudio_task_comment (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                content_repository_id VARCHAR(36) NOT NULL,
                workspace_name VARCHAR(255) NOT NULL,
                author_user_id VARCHAR(40) NOT NULL,
                text TEXT NOT NULL,
                created_at DATETIME NOT NULL,
                INDEX idx_task_comment_workspace (content_repository_id, workspace_name, created_at)
            ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB
            SQL);
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE medienreaktor_neosstudio_task_comment');
    }
}
