<?php
declare(strict_types=1);

namespace Neos\Flow\Persistence\Doctrine\Migrations;

use Doctrine\DBAL\Platforms\AbstractMySQLPlatform;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Review comments: comments move from the task workflow to the workspace, and
 * gain an optional anchor.
 *
 * The thread that matters in most installations hangs off a shared draft
 * reviewed against live, which is not a task branch - so the table is no
 * longer a task sidecar. The anchor columns pin a comment to a single change
 * (a node, in one dimension, on one page); all-null means the workspace's
 * general thread. Existing rows are exactly that, which is why the columns are
 * nullable rather than backfilled.
 */
final class Version20260825100000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Generalize task comments to workspace review comments (anchor + resolution)';
    }

    public function up(Schema $schema): void
    {
        $this->abortIf(
            !$this->connection->getDatabasePlatform() instanceof AbstractMySQLPlatform,
            "Migration can only be executed safely on 'Doctrine\DBAL\Platforms\AbstractMySQLPlatform'."
        );

        $this->addSql('RENAME TABLE medienreaktor_neosstudio_task_comment TO medienreaktor_neosstudio_comment');
        $this->addSql(<<<'SQL'
            ALTER TABLE medienreaktor_neosstudio_comment
                ADD document_aggregate_id VARCHAR(64) DEFAULT NULL,
                ADD node_aggregate_id VARCHAR(64) DEFAULT NULL,
                ADD dimension_space_point_hash VARCHAR(255) DEFAULT NULL,
                ADD dimension_space_point TEXT DEFAULT NULL,
                ADD resolved_at DATETIME DEFAULT NULL,
                ADD resolved_by_user_id VARCHAR(40) DEFAULT NULL
            SQL);
        $this->addSql('ALTER TABLE medienreaktor_neosstudio_comment ADD INDEX idx_review_comment_anchor (content_repository_id, workspace_name, node_aggregate_id, dimension_space_point_hash)');
    }

    public function down(Schema $schema): void
    {
        $this->abortIf(
            !$this->connection->getDatabasePlatform() instanceof AbstractMySQLPlatform,
            "Migration can only be executed safely on 'Doctrine\DBAL\Platforms\AbstractMySQLPlatform'."
        );

        // Anchored comments have nowhere to go in the old shape - they are
        // dropped rather than silently turned into general ones.
        $this->addSql('DELETE FROM medienreaktor_neosstudio_comment WHERE node_aggregate_id IS NOT NULL');
        $this->addSql('ALTER TABLE medienreaktor_neosstudio_comment DROP INDEX idx_review_comment_anchor');
        $this->addSql(<<<'SQL'
            ALTER TABLE medienreaktor_neosstudio_comment
                DROP COLUMN document_aggregate_id,
                DROP COLUMN node_aggregate_id,
                DROP COLUMN dimension_space_point_hash,
                DROP COLUMN dimension_space_point,
                DROP COLUMN resolved_at,
                DROP COLUMN resolved_by_user_id
            SQL);
        $this->addSql('RENAME TABLE medienreaktor_neosstudio_comment TO medienreaktor_neosstudio_task_comment');
    }
}
