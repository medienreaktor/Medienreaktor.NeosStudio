<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

use Neos\ContentRepository\Core\Projection\ContentGraph\ContentSubgraphInterface;
use Neos\ContentRepository\Core\Projection\ContentGraph\Filter\FindAncestorNodesFilter;
use Neos\ContentRepository\Core\Projection\ContentGraph\Node;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\NodeLabel\NodeLabelGeneratorInterface;

/**
 * Plain-text node labels and document breadcrumbs for the Studio's review,
 * history and trash read models - the same label the classic UI tree shows
 * (the node type's `label` expression, a custom generator, or the fallback),
 * decoded to plain text.
 */
#[Flow\Scope('singleton')]
class NodeLabelRenderer
{
    #[Flow\Inject]
    protected NodeLabelGeneratorInterface $nodeLabelGenerator;

    /**
     * The canonical human-readable label of a node, as plain text.
     */
    public function label(Node $node): string
    {
        return $this->plainTextLabel($this->nodeLabelGenerator->getLabel($node));
    }

    /**
     * Document labels from the site down to (and including) the node.
     *
     * @return array<int, string>
     */
    public function breadcrumb(Node $node, ContentSubgraphInterface $subgraph): array
    {
        $ancestors = $subgraph->findAncestorNodes(
            $node->aggregateId,
            FindAncestorNodesFilter::create(nodeTypes: 'Neos.Neos:Document')
        );
        $breadcrumb = [];
        // findAncestorNodes yields nearest-first; reverse for site-to-here order.
        foreach (array_reverse(iterator_to_array($ancestors)) as $ancestor) {
            $breadcrumb[] = $this->label($ancestor);
        }
        $breadcrumb[] = $this->label($node);

        return $breadcrumb;
    }

    /**
     * The label generator returns display text that may carry HTML entities
     * (e.g. "Tom &amp; Jerry") or stray markup; the client renders plain text.
     */
    private function plainTextLabel(string $label): string
    {
        $label = html_entity_decode($label, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $label = strip_tags($label);

        return trim($label);
    }
}
