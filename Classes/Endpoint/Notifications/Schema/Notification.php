<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Notifications\Schema;

use Medienreaktor\NeosStudio\Domain\Model;
use Neos\JsonSchema\Nullable;
use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\StringSchema;
use Neos\JsonSchema\Support\ObjectProperties;

/**
 * A notification addressed to the caller, produced by any package through the
 * Studio's NotificationService
 *
 * The schema is written out: the payload is a map, which schematic can't
 * discover
 */
final readonly class Notification implements ProvidesSchema
{
    /**
     * @param array<string, mixed>|\stdClass $payload
     */
    public function __construct(
        public NotificationId $id,
        public string $source,
        public string $type,
        public string $title,
        public string $message,
        public array|\stdClass $payload,
        public string $createdAt,
        public ?string $readAt,
    ) {
    }

    public static function from(Model\Notification $notification, string $identifier): self
    {
        return new self(
            NotificationId::fromString($identifier),
            $notification->getSource(),
            $notification->getType(),
            $notification->getTitle(),
            $notification->getMessage(),
            // encodes as [] otherwise
            $notification->getPayload() === [] ? new \stdClass() : $notification->getPayload(),
            $notification->getCreatedAt()->format(\DateTimeInterface::ATOM),
            $notification->getReadAt()?->format(\DateTimeInterface::ATOM),
        );
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'A notification addressed to the caller',
            properties: ObjectProperties::create(
                id: NotificationId::schema(),
                source: StringSchema::create(description: 'The package that produced it', examples: ['Medienreaktor.NeosStudio']),
                type: StringSchema::create(description: 'What happened, namespaced by the producer', examples: ['taskWorkflow.assigned']),
                title: StringSchema::create(description: 'The headline'),
                message: StringSchema::create(description: 'The text, may be empty'),
                payload: ObjectSchema::create(
                    description: 'Structured data whose shape only the producer knows, e.g. the workspace of a task',
                    additionalProperties: true,
                ),
                createdAt: StringSchema::create(description: 'When it was created, as ISO 8601', examples: ['2026-10-15T09:30:00+00:00']),
                readAt: Nullable::wrap(StringSchema::create(description: 'When it was marked read, as ISO 8601, null while unread')),
            ),
            additionalProperties: false,
            required: ['id', 'source', 'type', 'title', 'message', 'payload', 'createdAt', 'readAt'],
        );
    }
}
