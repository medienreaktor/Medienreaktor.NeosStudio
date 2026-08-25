<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Controller;

use GuzzleHttp\Psr7\Utils;
use Medienreaktor\NeosApi\Service\NodeAddressCodec;
use Neos\ContentRepository\Core\ContentRepository;
use Neos\ContentRepository\Core\Projection\ContentGraph\ContentSubgraphInterface;
use Neos\ContentRepository\Core\Projection\ContentGraph\Filter\FindClosestNodeFilter;
use Neos\ContentRepository\Core\Projection\ContentGraph\VisibilityConstraints;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAddress;
use Neos\ContentRepositoryRegistry\ContentRepositoryRegistry;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\Mvc\Controller\ActionController;
use Neos\Flow\Security\Context as SecurityContext;
use Neos\Neos\Domain\Model\RenderingMode;
use Neos\Neos\Domain\Service\NodeTypeNameFactory;
use Neos\Neos\Domain\Service\RenderingModeService;
use Neos\Neos\Domain\SubtreeTagging\NeosSubtreeTag;
use Neos\Neos\Domain\SubtreeTagging\NeosVisibilityConstraints;
use Neos\Neos\Security\Authorization\ContentRepositoryAuthorizationService;
use Neos\Neos\View\FusionView;
use Psr\Http\Message\ResponseInterface;

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
 * The "compare" flag is orthogonal to it: an edit-mode render carrying the
 * read-only compare script instead of the editing guest, for the side-by-side
 * review of a workspace against its base (see features/compare in the SPA).
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

    #[Flow\Inject]
    protected ContentRepositoryAuthorizationService $contentRepositoryAuthorizationService;

    #[Flow\Inject]
    protected SecurityContext $securityContext;

    public function showAction(string $node, string $mode = RenderingMode::FRONTEND, bool $includeDeleted = false, bool $compare = false): ResponseInterface|string
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
        if ($renderingMode->isEdit) {
            // Security-aware subgraph: the CR applies the current user's
            // visibility constraints, so this cannot leak inaccessible
            // content. Backend users may see disabled nodes - wanted here, so
            // hidden elements stay editable (rendered dimmed by the guest).
            $subgraph = $contentRepository->getContentSubgraph(
                $nodeAddress->workspaceName,
                $nodeAddress->dimensionSpacePoint
            );
            $subgraph = $this->withDeletedNodes($contentRepository, $nodeAddress, $subgraph, $includeDeleted);
        } else {
            // Frontend rendering shows the page as visitors would see it:
            // disabled nodes are excluded even though the backend user could
            // see them (mirrors the core frontend NodeController).
            // getContentGraph() still enforces workspace read access.
            $visibilityConstraints = $this->contentRepositoryAuthorizationService
                ->getVisibilityConstraints($contentRepository->id, $this->securityContext->getRoles())
                ->merge(NeosVisibilityConstraints::excludeDisabled());
            $subgraph = $contentRepository
                ->getContentGraph($nodeAddress->workspaceName)
                ->getSubgraph($nodeAddress->dimensionSpacePoint, $visibilityConstraints);
            $subgraph = $this->withDeletedNodes($contentRepository, $nodeAddress, $subgraph, $includeDeleted);
        }

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

        // no-store, not no-cache: the preview URL for a document never
        // changes, and Safari serves "no-cache" responses from its HTTP cache
        // without revalidating - a reloaded iframe would show the page as it
        // was before the edit until a hard reload. The page is per-user
        // workspace content anyway; nothing should ever store it.
        $this->response->setHttpHeader('Cache-Control', 'private, no-store');

        $this->view->setOption('renderingModeName', $renderingMode->name);
        $this->view->assignMultiple([
            'value' => $nodeInstance,
            'site' => $site,
        ]);

        if ($renderingMode->isEdit && !$this->view->canRenderWithNodeAndPath()) {
            $this->view->setFusionPath('rawContent');
        }

        // Render here (instead of letting the framework do it) to inject the
        // Studio guest script into edit-mode markup. It rides on the metadata
        // attributes of the existing "inPlace" mode, so no Studio-specific
        // rendering mode (which would surface in the classic UI's edit/preview
        // dropdown) and no Fusion overrides are needed. The classic UI's own
        // guest-frame additions are inert outside its host: Guest.html only
        // aliases window.parent.neos and loads a stylesheet - the interactive
        // guest app is injected by the classic host at runtime, never here.
        //
        // The compare view asks for the same metadata markup but a different
        // script: it reviews a workspace side by side against its base, where
        // nothing may be edited. Withholding the editing guest is what makes
        // the page inert - every interactive affordance (click-to-select,
        // inline editors, element handles, drop targets) is mounted by that
        // script alone, so its stand-in simply never creates them.
        $result = $this->view->render();
        $html = $result instanceof ResponseInterface ? (string)$result->getBody() : (string)$result;
        if ($renderingMode->isEdit) {
            $html = $this->injectScript($html, $compare ? 'compare.js' : 'guest.js');
        }

        if ($result instanceof ResponseInterface) {
            // A returned response replaces $this->response - re-apply the header.
            return $result
                ->withBody(Utils::streamFor($html))
                ->withHeader('Cache-Control', 'private, no-store');
        }
        return $html;
    }

    /**
     * Renders a DELETED page: deleting a node is a soft removal, so the page is
     * still there, tagged "removed" and therefore invisible to every ordinary
     * read. Showing it is what lets an editor look at what they deleted before
     * restoring it (the Studio's trash bin does exactly that), so the tag - and
     * only that tag - is dropped from the account's own constraints. Without
     * $includeDeleted the subgraph is returned untouched.
     */
    private function withDeletedNodes(
        ContentRepository $contentRepository,
        NodeAddress $nodeAddress,
        ContentSubgraphInterface $subgraph,
        bool $includeDeleted
    ): ContentSubgraphInterface {
        if (!$includeDeleted) {
            return $subgraph;
        }

        return $contentRepository->getContentGraph($nodeAddress->workspaceName)->getSubgraph(
            $nodeAddress->dimensionSpacePoint,
            VisibilityConstraints::excludeSubtreeTags(
                $subgraph->getVisibilityConstraints()->excludedSubtreeTags->without(NeosSubtreeTag::removed())
            )
        );
    }

    /**
     * Adds one of the Studio's iframe scripts to a rendered edit-mode page:
     * "guest.js" (click-to-select, inline editing, host bridge) for editing,
     * "compare.js" (change markers, scroll reporting) for the compare view.
     * Both are built by the Studio frontend build (vite.guest.config.ts,
     * vite.compare.config.ts) with stable filenames.
     */
    private function injectScript(string $html, string $fileName): string
    {
        $scriptFile = 'resource://Medienreaktor.NeosStudio/Public/Studio/' . $fileName;
        if (!is_file($scriptFile)) {
            return $html;
        }
        // Same static publishing target the SPA build uses as its base URL
        // (see vite.config.ts); mtime busts browser caches across rebuilds.
        $scriptUri = '/_Resources/Static/Packages/Medienreaktor.NeosStudio/Studio/' . $fileName . '?v=' . filemtime($scriptFile);
        $scriptTag = '<script src="' . htmlspecialchars($scriptUri, ENT_QUOTES) . '"></script>';

        $bodyEnd = strripos($html, '</body>');
        return $bodyEnd === false
            ? $html . $scriptTag
            : substr_replace($html, $scriptTag, $bodyEnd, 0);
    }
}
