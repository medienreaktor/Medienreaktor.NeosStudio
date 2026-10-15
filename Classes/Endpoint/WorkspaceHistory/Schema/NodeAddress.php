<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\WorkspaceHistory\Schema;

use Neos\Api\Endpoint\ContentRepositories\Schema\ContentRepositoryId;
use Neos\Api\Endpoint\Nodes\Schema\DimensionSpacePoint;
use Neos\Api\Endpoint\Nodes\Schema\NodeAggregateId;
use Neos\Api\Endpoint\Workspaces\Schema\WorkspaceName;
use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\Support\ObjectProperties;

/**
 * Where a node is, with the fields of the Neos API's Node: what getNode takes
 *
 * Only describes the nodes in the read models of this endpoint, which are
 * arrays
 */
final readonly class NodeAddress implements ProvidesSchema
{
    private function __construct()
    {
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'Where a node is, with the fields of the Neos API\'s Node',
            properties: ObjectProperties::create(
                contentRepositoryId: ContentRepositoryId::schema(),
                workspaceName: WorkspaceName::schema(),
                dimensionSpacePoint: DimensionSpacePoint::schema(),
                nodeAggregateId: NodeAggregateId::schema(),
            ),
            additionalProperties: false,
            required: ['contentRepositoryId', 'workspaceName', 'dimensionSpacePoint', 'nodeAggregateId'],
        );
    }
}
