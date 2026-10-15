<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Notifications\Schema;

use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\StringSchema;
use Neos\JsonSchema\Support\StringFormat;
use Neos\Schematic\Schematic;

final readonly class NotificationId implements ProvidesSchema
{
    private function __construct(
        public string $value,
    ) {
    }

    public static function fromString(string $value): self
    {
        return Schematic::instantiate(self::class, $value)->valueOrThrow();
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= StringSchema::create(
            description: 'The ID of a notification',
            examples: ['5c0b1f0e-3a4d-4b5e-8f6a-7b8c9d0e1f2a'],
            format: StringFormat::uuid,
        );
    }
}
