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

    public function allowsCallOfMethod($methodName): bool
    {
        return true;
    }
}
