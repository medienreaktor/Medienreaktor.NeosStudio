<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\CreationDialog\Domain;

use Neos\ContentRepository\Core\ContentRepository;
use Neos\ContentRepository\Core\Feature\NodeCreation\Command\CreateNodeAggregateWithNode;
use Neos\ContentRepository\Core\NodeType\NodeType;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\ObjectManagement\ObjectManagerInterface;
use Neos\Neos\Ui\Domain\NodeCreation\NodeCreationCommands;
use Neos\Neos\Ui\Domain\NodeCreation\NodeCreationElements;
use Neos\Neos\Ui\Domain\NodeCreation\NodeCreationHandlerFactoryInterface;
use Neos\Neos\Ui\Domain\NodeCreation\NodeCreationHandlerInterface;
use Neos\Utility\PositionalArraySorter;

/**
 * The node creation handlers of a node type (options.nodeCreationHandlers), run as the Neos UI runs them for its
 * creation dialog (AbstractCreate::applyNodeCreationHandlers()): the UI's uriPathSegment and promoted elements
 * handlers, Flowpack.NodeTemplates' templates and any a site registers
 *
 * The handler contract is the Neos UI's, so neos/neos-ui is only suggested: without it there are no handlers to run
 * (no package could register one). Its classes are only used in method bodies, which PHP and Flow don't resolve
 * unless they run
 */
#[Flow\Scope('singleton')]
final readonly class NodeCreationHandlers
{
    private const string FACTORY_INTERFACE = 'Neos\Neos\Ui\Domain\NodeCreation\NodeCreationHandlerFactoryInterface';

    public function __construct(
        private ObjectManagerInterface $objectManager,
    ) {
    }

    /**
     * Whether the node type has handlers to run: neos/neos-ui is installed, with the handler contract, and the node
     * type configures some
     */
    public static function existFor(NodeType $nodeType): bool
    {
        $configurations = $nodeType->getOptions()['nodeCreationHandlers'] ?? null;
        return interface_exists(self::FACTORY_INTERFACE) && is_array($configurations) && $configurations !== [];
    }

    /**
     * What the node type's handlers make of the creation: the command, changed, and the commands they add, e.g. a
     * template's child nodes
     *
     * @param array<string, mixed> $elements the creation dialog's values converted for the handlers, see CreationElements
     * @param array<mixed> $serializedElements the values as given
     * @throws \RuntimeException if a handler is misconfigured
     */
    public function apply(CreateNodeAggregateWithNode $command, NodeType $nodeType, array $elements, array $serializedElements, ContentRepository $contentRepository): NodeCreationCommands
    {
        $commands = NodeCreationCommands::fromFirstCommand($command, $contentRepository->getNodeTypeManager());
        $creationElements = new NodeCreationElements(elementValues: $elements, serializedValues: $serializedElements);
        $configurations = $nodeType->getOptions()['nodeCreationHandlers'] ?? [];
        foreach ((new PositionalArraySorter(is_array($configurations) ? $configurations : []))->toArray() as $key => $configuration) {
            $factoryClassName = is_array($configuration) ? $configuration['factoryClassName'] ?? null : null;
            if (!is_string($factoryClassName) || $factoryClassName === '') {
                throw new \RuntimeException(sprintf('The node creation handler %s of the node type %s has no factoryClassName', $key, $nodeType->name->value), 1792000011);
            }
            $factory = $this->objectManager->get($factoryClassName);
            if (!$factory instanceof NodeCreationHandlerFactoryInterface) {
                throw new \RuntimeException(sprintf('The factory %s of the node creation handler %s doesn\'t implement %s', $factoryClassName, $key, NodeCreationHandlerFactoryInterface::class), 1792000012);
            }
            $handler = $factory->build($contentRepository);
            if (!$handler instanceof NodeCreationHandlerInterface) {
                throw new \RuntimeException(sprintf('The factory %s of the node creation handler %s built no %s', $factoryClassName, $key, NodeCreationHandlerInterface::class), 1792000013);
            }
            $commands = $handler->handle($commands, $creationElements);
        }
        return $commands;
    }
}
