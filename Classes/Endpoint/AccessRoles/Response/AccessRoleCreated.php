<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\AccessRoles\Response;

use Medienreaktor\NeosStudio\Endpoint\AccessRoles\Schema\AccessRole;
use Neos\Api\Shared\Response\Created;
use Neos\OpenApi\Binding\TypeReference;
use Neos\OpenApi\Response\ApiResponseWithHeaders;

/**
 * A 201 with the new access role and where to find it
 */
final readonly class AccessRoleCreated implements ApiResponseWithHeaders
{
    use Created;

    public function __construct(
        private AccessRole $accessRole,
    ) {
    }

    public static function description(): string
    {
        return 'The access role was created';
    }

    public static function locationDescription(): string
    {
        return 'The URI of the new access role, relative to the request URI';
    }

    public static function bodyType(): TypeReference
    {
        return TypeReference::of(AccessRole::class);
    }

    public function body(): AccessRole
    {
        return $this->accessRole;
    }

    public function headers(): array
    {
        // resolved against POST …/accessroles, this is …/accessroles/{accessRoleId}
        return ['Location' => 'accessroles/' . $this->accessRole->id->value];
    }
}
