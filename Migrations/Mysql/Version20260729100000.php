<?php
declare(strict_types=1);

namespace Neos\Flow\Persistence\Doctrine\Migrations;

use Doctrine\DBAL\Platforms\AbstractMySQLPlatform;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Create the table for Studio notifications
 */
final class Version20260729100000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create the table for Studio notifications';
    }

    public function up(Schema $schema): void
    {
        $this->abortIf(
            !$this->connection->getDatabasePlatform() instanceof AbstractMySQLPlatform,
            "Migration can only be executed safely on 'Doctrine\DBAL\Platforms\AbstractMySQLPlatform'."
        );

        $this->addSql('CREATE TABLE medienreaktor_neosstudio_domain_model_notification (persistence_object_identifier VARCHAR(40) NOT NULL, userid VARCHAR(40) NOT NULL, source VARCHAR(255) NOT NULL, type VARCHAR(255) NOT NULL, title VARCHAR(255) NOT NULL, message LONGTEXT NOT NULL, payload JSON NOT NULL COMMENT \'(DC2Type:json)\', createdat DATETIME NOT NULL COMMENT \'(DC2Type:datetime_immutable)\', readat DATETIME DEFAULT NULL COMMENT \'(DC2Type:datetime_immutable)\', INDEX idx_notification_user_created (userid, createdat), INDEX idx_notification_user_read (userid, readat), PRIMARY KEY(persistence_object_identifier)) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');
    }

    public function down(Schema $schema): void
    {
        $this->abortIf(
            !$this->connection->getDatabasePlatform() instanceof AbstractMySQLPlatform,
            "Migration can only be executed safely on 'Doctrine\DBAL\Platforms\AbstractMySQLPlatform'."
        );

        $this->addSql('DROP TABLE medienreaktor_neosstudio_domain_model_notification');
    }
}
