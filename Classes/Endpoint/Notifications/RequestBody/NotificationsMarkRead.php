<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Notifications\RequestBody;

use Neos\JsonSchema\ArraySchema;
use Neos\JsonSchema\BooleanSchema;
use Neos\JsonSchema\Nullable;
use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\Support\ObjectProperties;
use Medienreaktor\NeosStudio\Endpoint\Notifications\Schema\NotificationId;

/**
 * Which of the caller's notifications to mark read: the ones by ID, or all
 */
final readonly class NotificationsMarkRead implements ProvidesSchema
{
    /**
     * @param list<string>|null $ids
     */
    public function __construct(
        public ?array $ids = null,
        public ?bool $all = null,
    ) {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'The notifications to mark read: ids, or all: true for all of them',
            examples: [['ids' => ['5c0b1f0e-3a4d-4b5e-8f6a-7b8c9d0e1f2a']], ['all' => true]],
            properties: ObjectProperties::create(
                ids: Nullable::wrap(ArraySchema::create(
                    description: 'The IDs of the notifications. IDs of notifications that aren\'t the caller\'s are left alone',
                    items: NotificationId::schema(),
                )),
                all: Nullable::wrap(BooleanSchema::create(description: 'true marks all of the caller\'s notifications read, ids are ignored then')),
            ),
            additionalProperties: false,
        );
    }
}
