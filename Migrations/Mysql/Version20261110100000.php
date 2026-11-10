<?php
declare(strict_types=1);

namespace Neos\Flow\Persistence\Doctrine\Migrations;

use Doctrine\DBAL\Platforms\AbstractMySQLPlatform;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Keep preview link secrets encrypted, so their creators can copy a link again
 */
final class Version20261110100000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Keep preview link secrets encrypted, so their creators can copy a link again';
    }

    public function up(Schema $schema): void
    {
        $this->abortIf(
            !$this->connection->getDatabasePlatform() instanceof AbstractMySQLPlatform,
            "Migration can only be executed safely on 'Doctrine\DBAL\Platforms\AbstractMySQLPlatform'."
        );

        // base64(nonce + secretbox of the URL secret), keyed from Flow's
        // encryption key. NULL for links created before this column existed:
        // only their hash was stored, so their URL is gone for good.
        $schema->getTable('medienreaktor_neosstudio_previewlink')
            ->addColumn('token_ciphertext', 'string', ['length' => 255, 'notnull' => false]);
    }

    public function down(Schema $schema): void
    {
        $schema->getTable('medienreaktor_neosstudio_previewlink')->dropColumn('token_ciphertext');
    }
}
