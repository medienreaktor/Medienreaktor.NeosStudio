<?php
declare(strict_types=1);

namespace Neos\Flow\Persistence\Doctrine\Migrations;

use Doctrine\DBAL\Platforms\AbstractMySQLPlatform;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Create the table for shareable preview links
 */
final class Version20260805100000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create the table for shareable preview links';
    }

    public function up(Schema $schema): void
    {
        $this->abortIf(
            !$this->connection->getDatabasePlatform() instanceof AbstractMySQLPlatform,
            "Migration can only be executed safely on 'Doctrine\DBAL\Platforms\AbstractMySQLPlatform'."
        );

        $table = $schema->createTable('medienreaktor_neosstudio_previewlink');
        $table->addColumn('id', 'string', ['length' => 36]);
        // SHA-256 of the URL secret; the secret itself is never persisted.
        $table->addColumn('token_hash', 'string', ['length' => 64, 'fixed' => true]);
        $table->addColumn('content_repository_id', 'string', ['length' => 16]);
        $table->addColumn('workspace_name', 'string', ['length' => 255]);
        $table->addColumn('dimension_space_point', 'json');
        $table->addColumn('node_aggregate_id', 'string', ['length' => 64]);
        $table->addColumn('label', 'string', ['length' => 255]);
        $table->addColumn('created_by_user_id', 'string', ['length' => 255]);
        $table->addColumn('created_at', 'datetime');
        $table->addColumn('expires_at', 'datetime');
        $table->setPrimaryKey(['id']);
        $table->addUniqueIndex(['token_hash'], 'uniq_previewlink_token_hash');
        $table->addIndex(['created_by_user_id'], 'idx_previewlink_creator');
        $table->addIndex(['expires_at'], 'idx_previewlink_expires_at');
    }

    public function down(Schema $schema): void
    {
        $schema->dropTable('medienreaktor_neosstudio_previewlink');
    }
}
