<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\CreationDialog;

use Medienreaktor\NeosStudio\Endpoint\CreationDialog\Domain\CreationElements;
use Medienreaktor\NeosStudio\Endpoint\CreationDialog\Domain\NodeCreationHandlers;
use Medienreaktor\NeosStudio\Endpoint\CreationDialog\RequestBody\CreationDialogNodeCreate;
use Neos\Api\Endpoint\ContentRepositories\Schema\ContentRepositoryId;
use Neos\Api\Endpoint\Nodes\Domain\SubgraphResolver;
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
use Neos\ContentRepository\Core\CommandHandler\Commands;
use Neos\ContentRepository\Core\ContentRepository;
use Neos\ContentRepository\Core\DimensionSpace\OriginDimensionSpacePoint;
use Neos\ContentRepository\Core\Feature\NodeCreation\Command\CreateNodeAggregateWithNode;
use Neos\ContentRepository\Core\Feature\NodeModification\Command\SetNodeProperties;
use Neos\ContentRepository\Core\Feature\NodeModification\Dto\PropertyValuesToWrite;
use Neos\ContentRepository\Core\Feature\NodeReferencing\Command\SetNodeReferences;
use Neos\ContentRepository\Core\Feature\NodeReferencing\Dto\NodeReferencesForName;
use Neos\ContentRepository\Core\Feature\NodeReferencing\Dto\NodeReferencesToWrite;
use Neos\ContentRepository\Core\Feature\Security\Exception\AccessDenied;
use Neos\ContentRepository\Core\NodeType\NodeTypeName;
use Neos\ContentRepository\Core\Projection\ContentGraph;
use Neos\ContentRepository\Core\Projection\ContentGraph\ContentSubgraphInterface;
use Neos\ContentRepository\Core\SharedModel;
use Neos\OpenApi\Attributes\Operation;
use Neos\OpenApi\Attributes\Parameter;
use Neos\OpenApi\Attributes\RequestBody;

/**
 * Creating a node through its creation dialog, as the Neos UI does: with the node type's node creation handlers
 * (options.nodeCreationHandlers, e.g. Flowpack.NodeTemplates' templates), which Neos.Api leaves to editing UIs
 *
 * As in the Neos UI, the handlers run before the node is created, on its creation command with the ids of its
 * tethered descendants generated in advance (NodeCreationCommands::fromFirstCommand()), so what they add can go into
 * them, e.g. a template's content in the main collection. The node is then created by Neos.Api's createNode with the
 * same node and tethered ids, with its checks, errors and response, and what the handlers make of the command is sent
 * after it: the properties and references they set on the node (except the ones the request states, which win, as
 * for the Neos UI) and the commands they add. Without neos/neos-ui, or for a node type without handlers, it is
 * createNode.
 */
final readonly class CreationDialog
{
    public function __construct(
        private Nodes $nodes,
        private ContentRepositoryFinder $contentRepositoryFinder,
        private SubgraphResolver $subgraphResolver,
        private PropertyValues $propertyValues,
        private CreationElements $creationElements,
        private NodeCreationHandlers $nodeCreationHandlers,
    ) {
    }

    #[Operation(
        path: '/cr/{contentRepositoryId}/creationdialog',
        method: 'POST',
        summary: 'Create a node through its creation dialog',
        description: 'Creates the node as createNode does, with the node type\'s node creation handlers (options.nodeCreationHandlers, e.g. Flowpack.NodeTemplates\' templates) as the Neos UI\'s creation dialog runs them, with the dialog\'s values in elements: they run before the node is created, then what they add is applied after it, the properties and references they set (the ones the request states win) and their commands, e.g. a template\'s child nodes, also in the tethered ones. Only with neos/neos-ui installed, which the handlers belong to, else it is createNode and elements are ignored. Elements or properties that don\'t fit their types and failing handlers are a 422 before anything is created; if one of the commands a handler adds can\'t be applied, it\'s a 422 and the node stays as far as it got. The response is the new node as getNode returns it without include.',
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
        // createNode's 400 and 404s, before the handlers look for the parent
        $subgraph = $this->subgraphResolver->resolve($contentRepositoryId, $workspaceName, $dimensionSpacePoint, excludeDisabled: false);
        if (!$subgraph instanceof ContentSubgraphInterface) {
            return $subgraph;
        }
        $parent = $this->subgraphResolver->resolveNodeIn($subgraph, $newNode->parentNodeAggregateId->toNodeAggregateId());
        if (!$parent instanceof ContentGraph\Node) {
            return $parent;
        }
        try {
            $elements = $this->creationElements->convert($nodeType, $newNode->elements);
            $properties = $this->propertyValues->toWrite($nodeType, $newNode->properties);
        } catch (InvalidPropertyValue $exception) {
            return UnprocessableContent::because($exception->getMessage());
        }
        $nodeAggregateId = $newNode->nodeAggregateId?->toNodeAggregateId() ?? SharedModel\Node\NodeAggregateId::create();
        try {
            $commands = $this->nodeCreationHandlers->apply(
                CreateNodeAggregateWithNode::create(
                    $parent->workspaceName,
                    $nodeAggregateId,
                    $nodeType->name,
                    OriginDimensionSpacePoint::fromDimensionSpacePoint($subgraph->getDimensionSpacePoint()),
                    $parent->aggregateId,
                    $newNode->succeedingSiblingNodeAggregateId?->toNodeAggregateId(),
                    $properties,
                ),
                $nodeType,
                $elements,
                $newNode->elements,
                $contentRepository,
            );
        } catch (\Exception $exception) {
            // a handler's own rules or its misconfiguration, as the Neos UI reports them
            return UnprocessableContent::because(sprintf('The node creation handlers of the node type %s failed: %s', $nodeType->name->value, $exception->getMessage()));
        }
        $created = $this->nodes->create($contentRepositoryId, $workspaceName, $newNode->toNodeCreate($commands->first), $dimensionSpacePoint);
        if (!$created instanceof NodeCreated) {
            return $created;
        }
        $node = $created->body();
        $failed = $this->applyFollowUps($node, $commands->first, $commands->additionalCommands, $newNode, $contentRepository);
        if ($failed !== null) {
            return $failed;
        }
        $read = $this->nodes->get($contentRepositoryId, $node->nodeAggregateId, $node->workspaceName, $node->dimensionSpacePoint);
        return $read instanceof Node ? NodeCreated::node($read) : $created;
    }

    /**
     * Sends what the handlers made of the creation command, null if it all worked. Not NodeCreationCommands: neos/neos-ui
     * is only suggested, its classes are only used in method bodies
     *
     * @param CreateNodeAggregateWithNode $first the creation command as the handlers changed it
     * @param Commands $additionalCommands the ones they added
     */
    private function applyFollowUps(Node $node, CreateNodeAggregateWithNode $first, Commands $additionalCommands, CreationDialogNodeCreate $newNode, ContentRepository $contentRepository): Forbidden|UnprocessableContent|null
    {
        // what the handlers set on the node itself, the stated values win, and what it has already (e.g. the
        // uriPathSegment createNode generated as the Neos UI's handler does) needs no event
        $followUps = [];
        $properties = array_filter(
            array_diff_key($first->initialPropertyValues->values, $newNode->properties),
            static fn (mixed $value, string $name) => !is_scalar($value) || ($node->properties[$name] ?? null) !== $value,
            ARRAY_FILTER_USE_BOTH,
        );
        if ($properties !== []) {
            $followUps[] = SetNodeProperties::create($first->workspaceName, $first->nodeAggregateId, $first->originDimensionSpacePoint, PropertyValuesToWrite::fromArray($properties));
        }
        $references = array_filter(
            $first->references->referencesForName,
            static fn (NodeReferencesForName $references) => !array_key_exists($references->referenceName->value, $newNode->references),
        );
        if ($references !== []) {
            $followUps[] = SetNodeReferences::create($first->workspaceName, $first->nodeAggregateId, $first->originDimensionSpacePoint, NodeReferencesToWrite::create(...$references));
        }

        foreach ([...$followUps, ...iterator_to_array($additionalCommands, false)] as $command) {
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
