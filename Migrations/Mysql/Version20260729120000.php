<?php
declare(strict_types=1);

namespace Neos\Flow\Persistence\Doctrine\Migrations;

use Doctrine\DBAL\Platforms\AbstractMySQLPlatform;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Rename the task workspace sidecar table: the task workflow moved from the
 * (dissolved) Medienreaktor.NeosTaskWorkflow package into Medienreaktor.NeosStudio
 */
final class Version20260729120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Rename the task workspace sidecar table (task workflow moved into Medienreaktor.NeosStudio)';
    }

    public function up(Schema $schema): void
    {
        $this->abortIf(
            !$this->connection->getDatabasePlatform() instanceof AbstractMySQLPlatform,
            "Migration can only be executed safely on 'Doctrine\DBAL\Platforms\AbstractMySQLPlatform'."
        );

        $this->addSql('RENAME TABLE medienreaktor_neostaskworkflow_task TO medienreaktor_neosstudio_task');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('RENAME TABLE medienreaktor_neosstudio_task TO medienreaktor_neostaskworkflow_task');
    }
}
