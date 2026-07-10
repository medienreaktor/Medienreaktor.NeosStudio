<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Controller;

use Medienreaktor\NeosApi\Service\NodeAddressCodec;
use Neos\ContentRepository\Core\Projection\ContentGraph\Filter\FindClosestNodeFilter;
use Neos\ContentRepositoryRegistry\ContentRepositoryRegistry;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\Mvc\Controller\ActionController;
use Neos\Neos\Domain\Model\RenderingMode;
use Neos\Neos\Domain\Service\NodeTypeNameFactory;
use Neos\Neos\Domain\Service\RenderingModeService;
use Neos\Neos\View\FusionView;

/**
 * Renders a single document for the Studio preview iframe, independent of the
 * Neos.Neos.Ui preview action. The node address (base64url, as used by the
 * Medienreaktor.NeosApi endpoints) carries the complete identity: content
 * repository, workspace, dimension space point and aggregate id - so the
 * workspace + dimension combination to preview is always explicit in the URL.
 *
 * The rendering mode is a request parameter instead of a user preference:
 * - "frontend" (default) renders the page exactly as visitors would see it
 * - any configured edit/preview mode (e.g. "inPlace") renders with the
 *   content-element metadata markup, which the Studio will need for
 *   click-to-select and in-place editing
 *
 * Access requires a logged-in backend user: the Neos.Neos:Backend session
 * provider covers this controller (see Settings.yaml) and the method
 * privilege below is granted to editors (see Policy.yaml). The iframe is
 * same-origin with the Studio shell, so the session cookie is sent along.
 */
class PreviewController extends ActionController
{
    /**
     * @var string
     */
    protected $defaultViewObjectName = FusionView::class;

    /**
     * @var FusionView
     */
    protected $view;

    #[Flow\Inject]
    protected ContentRepositoryRegistry $contentRepositoryRegistry;

    #[Flow\Inject]
    protected RenderingModeService $renderingModeService;

    public function showAction(string $node, string $mode = RenderingMode::FRONTEND): void
    {
        try {
            $renderingMode = $this->renderingModeService->findByName($mode);
        } catch (\Neos\Neos\Domain\Exception) {
            $this->throwStatus(400, sprintf('Unknown rendering mode "%s".', $mode));
        }

        try {
            $nodeAddress = NodeAddressCodec::decode($node);
        } catch (\Throwable) {
            $this->throwStatus(400, 'The node address could not be parsed.');
        }

        $contentRepository = $this->contentRepositoryRegistry->get($nodeAddress->contentRepositoryId);
        // Security-aware subgraph: the CR applies the current user's
        // visibility constraints, so this cannot leak inaccessible content.
        $subgraph = $contentRepository->getContentSubgraph(
            $nodeAddress->workspaceName,
            $nodeAddress->dimensionSpacePoint
        );

        $nodeInstance = $subgraph->findNodeById($nodeAddress->aggregateId);
        if ($nodeInstance === null) {
            $this->throwStatus(404, 'The node does not exist in this workspace and dimension or is not visible for the current user.');
        }

        $site = $subgraph->findClosestNode(
            $nodeAddress->aggregateId,
            FindClosestNodeFilter::create(nodeTypes: NodeTypeNameFactory::NAME_SITE)
        );
        if ($site === null) {
            $this->throwStatus(404, 'The node is not located inside a site.');
        }

        $this->response->setHttpHeader('Cache-Control', 'no-cache');

        $this->view->setOption('renderingModeName', $renderingMode->name);
        $this->view->assignMultiple([
            'value' => $nodeInstance,
            'site' => $site,
        ]);

        if ($renderingMode->isEdit && !$this->view->canRenderWithNodeAndPath()) {
            $this->view->setFusionPath('rawContent');
        }
    }
}
