<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

use Neos\ContentRepository\Core\SharedModel\Node\NodeAddress;

/**
 * URL-safe encoding for NodeAddress values: the address' JSON representation
 * as base64url, so a complete node identity (content repository, workspace,
 * dimension space point, aggregate id) travels as one opaque string. The
 * Studio shell builds the same encoding client-side (api/nodeAddress.ts) and
 * uses it as cache key, tree item id and in preview links.
 */
final class NodeAddressCodec
{
    public static function encode(NodeAddress $nodeAddress): string
    {
        return rtrim(strtr(base64_encode($nodeAddress->toJson()), '+/', '-_'), '=');
    }

    public static function decode(string $encoded): NodeAddress
    {
        $json = base64_decode(strtr($encoded, '-_', '+/'), true);
        if ($json === false) {
            throw new \InvalidArgumentException('Node address is not valid base64url.', 1751980020);
        }

        return NodeAddress::fromJsonString($json);
    }
}
