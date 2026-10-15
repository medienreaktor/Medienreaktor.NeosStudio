<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\PreviewLinks\Schema;

use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\StringSchema;
use Neos\JsonSchema\Support\StringFormat;
use Neos\Schematic\Schematic;

final readonly class PreviewLinkId implements ProvidesSchema
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
            description: 'The ID of a preview link (not its secret, which is only in its share URL)',
            examples: ['7d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d'],
            format: StringFormat::uuid,
        );
    }
}
