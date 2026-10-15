<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\PreviewLinks\RequestBody;

use Neos\Api\Endpoint\ContentRepositories\Schema\ContentRepositoryId;
use Neos\Api\Endpoint\Nodes\Schema\DimensionSpacePoint;
use Neos\Api\Endpoint\Nodes\Schema\NodeAggregateId;
use Neos\Api\Endpoint\Workspaces\Schema\WorkspaceName;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAddress;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * A new preview link: the document it shows, addressed with the fields of
 * Neos.Api's Node, and how long it works
 */
final readonly class PreviewLinkCreate implements ProvidesSchema
{
    /**
     * @param string|null $label what to call it in the list of links, empty if omitted
     * @param int|null $ttlHours how many hours it works, at least 1. The configured default lifetime if omitted, never longer than the configured maximum
     */
    public function __construct(
        public ContentRepositoryId $contentRepositoryId,
        public WorkspaceName $workspaceName,
        public DimensionSpacePoint $dimensionSpacePoint,
        public NodeAggregateId $nodeAggregateId,
        public ?string $label = null,
        public ?int $ttlHours = null,
    ) {
    }

    public function nodeAddress(): NodeAddress
    {
        return NodeAddress::create(
            $this->contentRepositoryId->toContentRepositoryId(),
            $this->workspaceName->toWorkspaceName(),
            $this->dimensionSpacePoint->toDimensionSpacePoint(),
            $this->nodeAggregateId->toNodeAggregateId(),
        );
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }
}
