<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Eel;

use Neos\ContentRepository\Core\Feature\SubtreeTagging\Dto\SubtreeTag;
use Neos\ContentRepository\Core\NodeType\NodeType;
use Neos\ContentRepository\Core\Projection\ContentGraph\Node;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAggregateClassification;
use Neos\ContentRepositoryRegistry\ContentRepositoryRegistry;
use Neos\Eel\ProtectedContextAwareInterface;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\I18n\Locale;
use Neos\Flow\I18n\Translator;
use Neos\Flow\Persistence\PersistenceManagerInterface;
use Neos\Neos\Domain\Service\NodeTypeNameFactory;
use Neos\Neos\Service\UserService;

/**
 * Eel helper for the Studio guest markup (see Root.fusion): computes which
 * content node types may be created inside a content collection (so the
 * markup can advertise valid drop targets) and the translated inline-editing
 * placeholder of a property - both without any client-side constraint or
 * translation model in the guest script.
 */
class StudioHelper implements ProtectedContextAwareInterface
{
    #[Flow\Inject]
    protected ContentRepositoryRegistry $contentRepositoryRegistry;

    #[Flow\Inject]
    protected Translator $translator;

    #[Flow\Inject]
    protected UserService $userService;

    #[Flow\Inject]
    protected PersistenceManagerInterface $persistenceManager;

    /**
     * The concrete/interface Media classes an image-typed property may declare.
     * Both the interface (the usual NodeType declaration) and the concrete
     * class are matched, with or without a leading backslash.
     */
    private const IMAGE_PROPERTY_TYPES = [
        'Neos\Media\Domain\Model\ImageInterface',
        'Neos\Media\Domain\Model\Image',
    ];

    /**
     * Names of the non-abstract content node types allowed as children of the
     * given node. Matches the classic UI's semantics: for tethered nodes
     * (autocreated collections) the constraints of the declaring parent's
     * tethered-child definition apply, for regular nodes the node type's own
     * constraints. Only node types with a ui.group are candidates - by Neos
     * convention only those are user-creatable.
     *
     * @return array<int, string>
     */
    public function allowedChildNodeTypes(Node $node): array
    {
        $nodeTypeManager = $this->contentRepositoryRegistry->get($node->contentRepositoryId)->getNodeTypeManager();
        $nodeType = $nodeTypeManager->getNodeType($node->nodeTypeName);
        if ($nodeType === null) {
            return [];
        }

        $tetheredParentNodeType = null;
        if ($node->classification === NodeAggregateClassification::CLASSIFICATION_TETHERED && $node->name !== null) {
            $parentNode = $this->contentRepositoryRegistry->subgraphForNode($node)->findParentNode($node->aggregateId);
            $tetheredParentNodeType = $parentNode?->nodeTypeName;
        }

        $allowedNodeTypeNames = [];
        foreach ($nodeTypeManager->getSubNodeTypes(NodeTypeNameFactory::forContent(), false) as $candidate) {
            /** @var NodeType $candidate */
            if ($candidate->getConfiguration('ui.group') === null) {
                continue;
            }
            $allowed = $tetheredParentNodeType !== null
                ? $nodeTypeManager->isNodeTypeAllowedAsChildToTetheredNode($tetheredParentNodeType, $node->name, $candidate->name)
                : $nodeType->allowsChildNodeType($candidate);
            if ($allowed) {
                $allowedNodeTypeNames[] = $candidate->name->value;
            }
        }

        return $allowedNodeTypeNames;
    }

    /**
     * Whether the node itself is hidden (explicitly tagged "disabled", not
     * merely inside a hidden subtree). Rendered into the wrapping markup so
     * the guest can dim the element, and the element menu offers "Unhide" -
     * which only works where the tag was actually set.
     */
    public function isHidden(Node $node): bool
    {
        return $node->tags->withoutInherited()->contain(SubtreeTag::disabled());
    }

    /**
     * Whether the node is only visible through dimension fallback ("shines
     * through"): the dimension it is viewed in differs from its origin
     * dimension space point. Rendered into the wrapping markup so the guest
     * can pattern/dim the element and offer explicit variant creation.
     */
    public function isShineThrough(Node $node): bool
    {
        return $node->dimensionSpacePoint->coordinates !== $node->originDimensionSpacePoint->coordinates;
    }

    /**
     * The inline-editing placeholder for a property, translated for the
     * backend user's interface language - rendered into the editable markup
     * so the guest script can show it on empty properties. Node type loading
     * (NodeTypeEnrichmentService) has already expanded the "i18n" magic value
     * into a full label id. Returns null (= no attribute) when nothing is
     * configured or the id has no translation.
     */
    public function inlinePlaceholder(Node $node, string $property): ?string
    {
        $nodeType = $this->contentRepositoryRegistry->get($node->contentRepositoryId)
            ->getNodeTypeManager()
            ->getNodeType($node->nodeTypeName);
        $placeholder = $nodeType?->getConfiguration(
            'properties.' . $property . '.ui.inline.editorOptions.placeholder'
        );
        if (!is_string($placeholder) || $placeholder === '') {
            return null;
        }

        // "Package:Source:trans.unit.id" - anything else is a literal.
        if (substr_count($placeholder, ':') !== 2 || str_contains($placeholder, ' ')) {
            return strip_tags($placeholder);
        }
        [$packageKey, $sourceName, $labelId] = explode(':', $placeholder);
        try {
            $translation = $this->translator->translateById(
                $labelId,
                [],
                null,
                new Locale($this->userService->getInterfaceLanguage()),
                str_replace('.', '/', $sourceName),
                $packageKey
            );
        } catch (\Throwable) {
            return null;
        }

        return $translation !== null ? strip_tags($translation) : null;
    }

    /**
     * The inline-editing formatting configuration of a property
     * (properties.<name>.ui.inline.editorOptions), rendered into the editable
     * markup so the guest can build the rich-text schema and toolbar from the
     * NodeType definition: the `formatting` flags (strong, em, h1..h6, ol, ul,
     * a, ...) plus `autoparagraph`, which decides single-line vs multi-block.
     * Returns null when the property carries no editor options (the guest then
     * falls back to a permissive default schema).
     *
     * @return array<string, mixed>|null
     */
    public function inlineFormatting(Node $node, string $property): ?array
    {
        $nodeType = $this->contentRepositoryRegistry->get($node->contentRepositoryId)
            ->getNodeTypeManager()
            ->getNodeType($node->nodeTypeName);
        $editorOptions = $nodeType?->getConfiguration(
            'properties.' . $property . '.ui.inline.editorOptions'
        );
        if (!is_array($editorOptions)) {
            return null;
        }
        $formatting = $editorOptions['formatting'] ?? [];

        return [
            'formatting' => is_array($formatting) ? $formatting : [],
            'autoparagraph' => $editorOptions['autoparagraph'] ?? null,
        ];
    }

    /**
     * The name of the node's single image-typed property, or null when it has
     * none or more than one. Rendered onto the content-element wrapping so the
     * guest can offer in-place image selection on the rendered <img> even when
     * the image is emitted as a bare src (Neos.Neos:ImageUri + a plain <img>,
     * as the Neos.Demo does) - the <img> itself carries no node/property, but
     * its enclosing content element does. Left unset for nodes with several
     * image properties, where a single <img> cannot be attributed to one of
     * them from the wrapping alone (use the Neos.Neos:ImageTag path for those).
     */
    public function singleImageProperty(Node $node): ?string
    {
        $nodeType = $this->contentRepositoryRegistry->get($node->contentRepositoryId)
            ->getNodeTypeManager()
            ->getNodeType($node->nodeTypeName);
        if ($nodeType === null) {
            return null;
        }

        $imageProperties = [];
        foreach ($nodeType->getProperties() as $name => $configuration) {
            if ($this->isImageType($configuration['type'] ?? null)) {
                $imageProperties[] = $name;
            }
        }

        return count($imageProperties) === 1 ? $imageProperties[0] : null;
    }

    /**
     * The name of the node property whose value is the given asset - used to
     * annotate a rendered Neos.Neos:ImageTag with the property it came from
     * (the tag receives the asset object, not the property name). Matches by
     * persistence identifier across the node's object-valued properties, so an
     * image among several image properties is attributed precisely. Returns
     * null when the asset is not held by any property (e.g. a menu thumbnail).
     */
    public function imageProperty(?Node $node, mixed $asset): ?string
    {
        if ($node === null || !is_object($asset)) {
            return null;
        }
        $assetIdentifier = $this->persistenceManager->getIdentifierByObject($asset);
        if ($assetIdentifier === null) {
            return null;
        }
        foreach ($node->properties as $name => $value) {
            if (is_object($value)
                && $this->persistenceManager->getIdentifierByObject($value) === $assetIdentifier) {
                return $name;
            }
        }
        return null;
    }

    private function isImageType(?string $type): bool
    {
        if ($type === null) {
            return false;
        }
        return in_array(ltrim($type, '\\'), self::IMAGE_PROPERTY_TYPES, true);
    }

    public function allowsCallOfMethod($methodName): bool
    {
        return true;
    }
}
