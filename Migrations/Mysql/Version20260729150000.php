<?php
declare(strict_types=1);

namespace Neos\Flow\Persistence\Doctrine\Migrations;

use Doctrine\DBAL\Platforms\AbstractMySQLPlatform;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Drop the ticket reference and due date columns - tasks carry only
 * status/assignee, everything else lives on the workspace
 */
final class Version20260729150000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Drop the ticket reference and due date columns from task workspaces';
    }

    public function up(Schema $schema): void
    {
        $this->abortIf(
            !$this->connection->getDatabasePlatform() instanceof AbstractMySQLPlatform,
            "Migration can only be executed safely on 'Doctrine\DBAL\Platforms\AbstractMySQLPlatform'."
        );

        $this->addSql('ALTER TABLE medienreaktor_neosstudio_task DROP COLUMN ticket_reference, DROP COLUMN due_date');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE medienreaktor_neosstudio_task ADD ticket_reference VARCHAR(255) DEFAULT NULL, ADD due_date DATETIME DEFAULT NULL');
    }
}
