<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Tasks\Schema;

use Medienreaktor\NeosStudio\Domain\Model;
use Neos\Api\Endpoint\Users\Schema\UserId;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * A comment on a task
 */
final readonly class TaskComment implements ProvidesSchema
{
    /**
     * @param int $id the ID of the comment
     * @param UserId|null $author who wrote it, null if that user is gone
     * @param string|null $authorLabel the author's name, so reading comments doesn't need users.read
     * @param string $createdAt when it was written, as ISO 8601
     */
    public function __construct(
        public int $id,
        public UserId|null $author,
        public string|null $authorLabel,
        public string $text,
        public string $createdAt,
    ) {
    }

    public static function from(Model\TaskComment $comment, ?string $authorLabel): self
    {
        return new self(
            (int)$comment->id,
            $comment->authorUserId !== null ? UserId::fromString($comment->authorUserId->value) : null,
            $authorLabel,
            $comment->text,
            $comment->createdAt->format(\DateTimeInterface::ATOM),
        );
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }
}
