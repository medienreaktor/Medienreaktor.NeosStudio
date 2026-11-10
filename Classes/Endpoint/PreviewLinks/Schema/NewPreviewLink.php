<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\PreviewLinks\Schema;

use Neos\Api\Endpoint\ContentRepositories\Schema\ContentRepositoryId;
use Neos\Api\Endpoint\Nodes\Schema\DimensionSpacePoint;
use Neos\Api\Endpoint\Nodes\Schema\NodeAggregateId;
use Neos\Api\Endpoint\Workspaces\Schema\WorkspaceName;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * A preview link just created, with its share URL
 */
final readonly class NewPreviewLink implements ProvidesSchema
{
    /**
     * @param string $label what the creator called it, may be empty
     * @param string $createdAt when it was created, as ISO 8601
     * @param string $expiresAt when it stops working, as ISO 8601
     * @param string $shareUrl the absolute URL to share
     */
    public function __construct(
        public PreviewLinkId $id,
        public string $label,
        public ContentRepositoryId $contentRepositoryId,
        public WorkspaceName $workspaceName,
        public DimensionSpacePoint $dimensionSpacePoint,
        public NodeAggregateId $nodeAggregateId,
        public string $createdAt,
        public string $expiresAt,
        public string $shareUrl,
    ) {
    }

    public static function of(PreviewLink $link): self
    {
        return new self(
            $link->id,
            $link->label,
            $link->contentRepositoryId,
            $link->workspaceName,
            $link->dimensionSpacePoint,
            $link->nodeAggregateId,
            $link->createdAt,
            $link->expiresAt,
            $link->shareUrl ?? throw new \LogicException('A preview link just created has a share URL', 1762770001),
        );
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }
}
