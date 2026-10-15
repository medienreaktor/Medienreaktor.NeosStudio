<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\CreationDialog;

use Medienreaktor\NeosStudio\Endpoint\CreationDialog\Domain\CreationElements;
use Medienreaktor\NeosStudio\Endpoint\CreationDialog\Domain\NodeCreationHandlers;
use Medienreaktor\NeosStudio\Endpoint\CreationDialog\RequestBody\CreationDialogNodeCreate;
use Neos\Api\Endpoint\ContentRepositories\Schema\ContentRepositoryId;
use Neos\Api\Endpoint\Nodes\Nodes;
use Neos\Api\Endpoint\Nodes\Response\NodeCreated;
use Neos\Api\Endpoint\Nodes\Schema\DimensionSpacePoint;
use Neos\Api\Endpoint\Nodes\Schema\Node;
use Neos\Api\Endpoint\Workspaces\Schema\WorkspaceName;
use Neos\Api\Infrastructure\ContentRepository\ContentRepositoryFinder;
use Neos\Api\Infrastructure\ContentRepository\InvalidPropertyValue;
use Neos\Api\Infrastructure\ContentRepository\PropertyValues;
use Neos\Api\Security\ApiAuthContextProvider;
use Neos\Api\Security\ApiScopes;
use Neos\Api\Shared\Response\BadRequest;
use Neos\Api\Shared\Response\Conflict;
use Neos\Api\Shared\Response\Forbidden;
use Neos\Api\Shared\Response\NotFound;
use Neos\Api\Shared\Response\UnprocessableContent;
use Neos\ContentRepository\Core\ContentRepository;
use Neos\ContentRepository\Core\DimensionSpace\OriginDimensionSpacePoint;
use Neos\ContentRepository\Core\Feature\NodeCreation\Command\CreateNodeAggregateWithNode;
use Neos\ContentRepository\Core\Feature\NodeModification\Command\SetNodeProperties;
use Neos\ContentRepository\Core\Feature\NodeModification\Dto\PropertyValuesToWrite;
use Neos\ContentRepository\Core\Feature\NodeReferencing\Command\SetNodeReferences;
use Neos\ContentRepository\Core\Feature\NodeReferencing\Dto\NodeReferencesForName;
use Neos\ContentRepository\Core\Feature\NodeReferencing\Dto\NodeReferencesToWrite;
use Neos\ContentRepository\Core\Feature\Security\Exception\AccessDenied;
use Neos\ContentRepository\Core\NodeType\NodeType;
use Neos\ContentRepository\Core\NodeType\NodeTypeName;
use Neos\ContentRepository\Core\SharedModel;
use Neos\OpenApi\Attributes\Operation;
use Neos\OpenApi\Attributes\Parameter;
use Neos\OpenApi\Attributes\RequestBody;

/**
 * Creating a node through its creation dialog, as the Neos UI does: with the node type's node creation handlers
 * (options.nodeCreationHandlers, e.g. Flowpack.NodeTemplates' templates), which Neos.Api leaves to editing UIs
 *
 * The node is created by Neos.Api's createNode, with its checks, errors and response. The handlers then run on the
 * same creation command, and what they make of it is sent after it: the properties and references they set on the
 * node (except the ones the request states, which win, as for the Neos UI) and the commands they add, e.g. a
 * template's child nodes. Without neos/neos-ui, or for a node type without handlers, it is createNode.
 */
final readonly class CreationDialog
{
    public function __construct(
        private Nodes $nodes,
        private ContentRepositoryFinder $contentRepositoryFinder,
        private PropertyValues $propertyValues,
        private CreationElements $creationElements,
        private NodeCreationHandlers $nodeCreationHandlers,
    ) {
    }

    #[Operation(
        path: '/cr/{contentRepositoryId}/creationdialog',
        method: 'POST',
        summary: 'Create a node through its creation dialog',
        description: 'Creates the node as createNode does, then runs the node type\'s node creation handlers (options.nodeCreationHandlers, e.g. Flowpack.NodeTemplates\' templates) as the Neos UI\'s creation dialog does, with the dialog\'s values in elements, and applies what they add: the properties and references they set (the ones the request states win) and their commands, e.g. a template\'s child nodes. Only with neos/neos-ui installed, which the handlers belong to, else it is createNode and elements are ignored. Elements that don\'t fit their types are a 422 before anything is created; if a handler fails or one of the commands it adds can\'t be applied, it\'s a 422 and the node stays as far as it got. The response is the new node as getNode returns it without include.',
        operationId: 'createNodeFromCreationDialog',
        security: [
            ApiAuthContextProvider::SCOPES => [ApiScopes::NODES_CREATE],
        ],
    )]
    public function create(
        ContentRepositoryId $contentRepositoryId,
        #[Parameter(in: 'query', description: 'The workspace to create the node in, as for createNode')]
        WorkspaceName $workspaceName,
        #[RequestBody(description: 'The node and the values of its creation dialog')] CreationDialogNodeCreate $newNode,
        #[Parameter(in: 'query', description: 'The dimension space point to create the node in, its origin, as JSON, as for createNode')]
        DimensionSpacePoint|null $dimensionSpacePoint = null,
    ): NodeCreated|NotFound|BadRequest|Forbidden|Conflict|UnprocessableContent {
        $contentRepository = $this->contentRepositoryFinder->find($contentRepositoryId->toContentRepositoryId());
        $nodeType = $contentRepository?->getNodeTypeManager()->getNodeType(NodeTypeName::fromString($newNode->nodeType->value));
        if ($contentRepository === null || $nodeType === null || !NodeCreationHandlers::existFor($nodeType)) {
            // createNode's 404 and 422 if there is no such content repository or node type
            return $this->nodes->create($contentRepositoryId, $workspaceName, $newNode->toNodeCreate(), $dimensionSpacePoint);
        }
        // before anything is created
        try {
            $elements = $this->creationElements->convert($nodeType, $newNode->elements);
        } catch (InvalidPropertyValue $exception) {
            return UnprocessableContent::because($exception->getMessage());
        }
        $created = $this->nodes->create($contentRepositoryId, $workspaceName, $newNode->toNodeCreate(), $dimensionSpacePoint);
        if (!$created instanceof NodeCreated) {
            return $created;
        }
        $node = $created->body();
        $failed = $this->applyNodeCreationHandlers($node, $nodeType, $newNode, $elements, $contentRepository);
        if ($failed !== null) {
            return $failed;
        }
        $read = $this->nodes->get($contentRepositoryId, $node->nodeAggregateId, $node->workspaceName, $node->dimensionSpacePoint);
        return $read instanceof Node ? NodeCreated::node($read) : $created;
    }

    /**
     * Runs the handlers on the command the node was created with and sends what they add, null if it all worked
     *
     * @param array<string, mixed> $elements converted, see CreationElements
     */
    private function applyNodeCreationHandlers(Node $node, NodeType $nodeType, CreationDialogNodeCreate $newNode, array $elements, ContentRepository $contentRepository): Forbidden|UnprocessableContent|null
    {
        $workspaceName = SharedModel\Workspace\WorkspaceName::fromString($node->workspaceName->value);
        $nodeAggregateId = SharedModel\Node\NodeAggregateId::fromString($node->nodeAggregateId->value);
        $origin = OriginDimensionSpacePoint::fromDimensionSpacePoint($node->originDimensionSpacePoint->toDimensionSpacePoint());
        try {
            $commands = $this->nodeCreationHandlers->apply(
                CreateNodeAggregateWithNode::create(
                    $workspaceName,
                    $nodeAggregateId,
                    $nodeType->name,
                    $origin,
                    $newNode->parentNodeAggregateId->toNodeAggregateId(),
                    $newNode->succeedingSiblingNodeAggregateId?->toNodeAggregateId(),
                    // createNode took them, so they convert
                    $this->propertyValues->toWrite($nodeType, $newNode->properties),
                ),
                $nodeType,
                $elements,
                $newNode->elements,
                $contentRepository,
            );
        } catch (\Exception $exception) {
            // a handler's own rules or its misconfiguration, as the Neos UI reports them
            return UnprocessableContent::because(sprintf('The node %s was created, but the node creation handlers of the node type %s failed: %s', $node->nodeAggregateId->value, $nodeType->name->value, $exception->getMessage()));
        }

        // what the handlers set on the node itself, the stated values win, and what it has already (e.g. the
        // uriPathSegment createNode generated as the Neos UI's handler does) needs no event
        $followUps = [];
        $properties = array_filter(
            array_diff_key($commands->first->initialPropertyValues->values, $newNode->properties),
            static fn (mixed $value, string $name) => !is_scalar($value) || ($node->properties[$name] ?? null) !== $value,
            ARRAY_FILTER_USE_BOTH,
        );
        if ($properties !== []) {
            $followUps[] = SetNodeProperties::create($workspaceName, $nodeAggregateId, $origin, PropertyValuesToWrite::fromArray($properties));
        }
        $references = array_filter(
            $commands->first->references->referencesForName,
            static fn (NodeReferencesForName $references) => !array_key_exists($references->referenceName->value, $newNode->references),
        );
        if ($references !== []) {
            $followUps[] = SetNodeReferences::create($workspaceName, $nodeAggregateId, $origin, NodeReferencesToWrite::create(...$references));
        }

        foreach ([...$followUps, ...iterator_to_array($commands->additionalCommands, false)] as $command) {
            try {
                $contentRepository->handle($command);
            } catch (AccessDenied $exception) {
                return Forbidden::because(sprintf('The node %s was created, but you may not apply what its node creation handlers add: %s', $node->nodeAggregateId->value, $exception->getMessage()));
            } catch (\Exception $exception) {
                return UnprocessableContent::because(sprintf('The node %s was created without everything its node creation handlers add: %s', $node->nodeAggregateId->value, $exception->getMessage()));
            }
        }
        return null;
    }
}
