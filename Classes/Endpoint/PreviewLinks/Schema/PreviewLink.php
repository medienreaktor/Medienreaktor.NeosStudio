<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\PreviewLinks\Schema;

use Medienreaktor\NeosStudio\Domain\Model;
use Neos\Api\Endpoint\ContentRepositories\Schema\ContentRepositoryId;
use Neos\Api\Endpoint\Nodes\Schema\DimensionSpacePoint;
use Neos\Api\Endpoint\Nodes\Schema\NodeAggregateId;
use Neos\Api\Endpoint\Workspaces\Schema\WorkspaceName;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * A preview link: anybody with its URL sees one document as the website would
 * show it (hidden pages included) until it expires, without logging in
 *
 * The node is addressed with the fields of Neos.Api's Node. Only its creator
 * ever sees it, so it carries its share URL
 */
final readonly class PreviewLink implements ProvidesSchema
{
    /**
     * @param string $label what the creator called it, may be empty
     * @param string $createdAt when it was created, as ISO 8601
     * @param string $expiresAt when it stops working, as ISO 8601
     * @param string|null $shareUrl the absolute URL to share. Null when it can't be recovered: links created before share URLs were kept, or kept under a since changed encryption key. Those still work for whoever has the URL
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
        public ?string $shareUrl,
    ) {
    }

    public static function from(Model\PreviewLink $link, ?string $shareUrl): self
    {
        return new self(
            PreviewLinkId::fromString($link->id),
            $link->label,
            ContentRepositoryId::fromString($link->contentRepositoryId->value),
            WorkspaceName::fromString($link->workspaceName->value),
            DimensionSpacePoint::from($link->dimensionSpacePoint),
            NodeAggregateId::fromString($link->nodeAggregateId->value),
            $link->createdAt->format(\DateTimeInterface::ATOM),
            $link->expiresAt->format(\DateTimeInterface::ATOM),
            $shareUrl,
        );
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }
}
