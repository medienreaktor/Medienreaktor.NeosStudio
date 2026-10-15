<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

use Neos\ContentRepository\Core\DimensionSpace\DimensionSpacePoint;
use Neos\ContentRepository\Core\Projection\ContentGraph\Node;
use Neos\ContentRepository\Core\SharedModel\ContentRepository\ContentRepositoryId;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAddress;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAggregateId;
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;

/**
 * A node's identity as the Studio's endpoints read and write it: the four
 * fields Neos.Api's Node schema identifies a node by - contentRepositoryId,
 * workspaceName, dimensionSpacePoint (as JSON) and nodeAggregateId - so the
 * shell handles one shape for nodes from both APIs.
 */
final class NodeAddresses
{
    /**
     * @return array{contentRepositoryId: string, workspaceName: string, dimensionSpacePoint: string, nodeAggregateId: string}
     */
    public static function toArray(NodeAddress|Node $address): array
    {
        if ($address instanceof Node) {
            $address = NodeAddress::fromNode($address);
        }

        return [
            'contentRepositoryId' => $address->contentRepositoryId->value,
            'workspaceName' => $address->workspaceName->value,
            'dimensionSpacePoint' => $address->dimensionSpacePoint->toJson(),
            'nodeAggregateId' => $address->aggregateId->value,
        ];
    }

    /**
     * The address in the four fields of a request body or query.
     *
     * @param array<mixed> $fields
     * @throws \InvalidArgumentException if a field is missing or invalid
     */
    public static function fromArray(array $fields): NodeAddress
    {
        foreach (['contentRepositoryId', 'workspaceName', 'dimensionSpacePoint', 'nodeAggregateId'] as $name) {
            if (!is_string($fields[$name] ?? null)) {
                throw new \InvalidArgumentException(sprintf('The node address needs "%s".', $name), 1792060201);
            }
        }

        return NodeAddress::create(
            ContentRepositoryId::fromString($fields['contentRepositoryId']),
            WorkspaceName::fromString($fields['workspaceName']),
            DimensionSpacePoint::fromJsonString($fields['dimensionSpacePoint']),
            NodeAggregateId::fromString($fields['nodeAggregateId']),
        );
    }
}
