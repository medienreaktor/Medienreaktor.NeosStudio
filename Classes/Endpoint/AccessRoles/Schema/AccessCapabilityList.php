<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\AccessRoles\Schema;

use Medienreaktor\NeosStudio\Domain\Model\AccessRoleConstraints;
use Neos\JsonSchema\ArraySchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\StringSchema;

/**
 * The capabilities an access role can withhold, the keys of its constraints'
 * capabilities
 */
final readonly class AccessCapabilityList implements ProvidesSchema
{
    /**
     * @var list<string>
     */
    public array $capabilities;

    public function __construct(string ...$capabilities)
    {
        $this->capabilities = array_values($capabilities);
    }

    public static function all(): self
    {
        return new self(...AccessRoleConstraints::CAPABILITIES);
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ArraySchema::create(
            description: 'The capabilities an access role can withhold',
            items: StringSchema::create(examples: AccessRoleConstraints::CAPABILITIES),
        );
    }
}
