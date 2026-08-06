<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Controller;

use Medienreaktor\NeosStudio\Service\PreviewLinkService;
use Neos\ContentRepository\Core\Projection\ContentGraph\Filter\FindClosestNodeFilter;
use Neos\ContentRepositoryRegistry\ContentRepositoryRegistry;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\Mvc\Controller\ActionController;
use Neos\Flow\Security\Context as SecurityContext;
use Neos\Neos\Domain\Model\RenderingMode;
use Neos\Neos\Domain\Service\NodeTypeNameFactory;
use Neos\Neos\Domain\SubtreeTagging\NeosVisibilityConstraints;
use Neos\Neos\View\FusionView;
use Psr\Http\Message\ResponseInterface;

/**
 * The anonymous consumption side of shareable preview links: renders the one
 * document a validated link pins, exactly as a site visitor would see it.
 *
 * Access control is the token alone. The action is granted to
 * Neos.Flow:Everybody (see Policy.yaml - required, since the core's
 * AllControllerActions catch-all would otherwise force authentication) and
 * excluded from the backend session provider's request pattern (see
 * Settings.yaml), so the endpoint is fully sessionless and anonymous.
 * Because the visitor has no account, the content
 * repository's structural read check on the workspace is bypassed for
 * exactly this one subgraph read - inside a security context that pins the
 * frontend visibility constraints (no disabled, no removed content), and
 * only after the token proved that an editor with read access to that
 * workspace created the link (enforced at minting, PreviewLinksController).
 *
 * Rendering is strictly frontend mode: no edit metadata, no guest script,
 * no deleted-node resurrection - none of the PreviewController's editor
 * affordances exist here.
 */
class ShareController extends ActionController
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
    protected PreviewLinkService $previewLinkService;

    #[Flow\Inject]
    protected SecurityContext $securityContext;

    public function showAction(string $token): ResponseInterface|string
    {
        $link = $this->previewLinkService->validateToken($token);
        if ($link === null) {
            // The token is the credential, so a failed validation is an
            // authentication failure - 401, not 404. Unknown, malformed,
            // expired and revoked tokens answer identically. (No
            // WWW-Authenticate header: there is nothing to challenge for,
            // and without it browsers show no credentials dialog.)
            $this->throwStatus(401, 'This preview link is invalid or has expired.');
        }

        $nodeAddress = $link->nodeAddress();
        $contentRepository = $this->contentRepositoryRegistry->get($nodeAddress->contentRepositoryId);

        // What a visitor would see if this workspace were the live site:
        // disabled ("hidden") and removed (soft-deleted) content excluded,
        // stated explicitly rather than derived from the (absent) account.
        $visibilityConstraints = NeosVisibilityConstraints::excludeRemoved()
            ->merge(NeosVisibilityConstraints::excludeDisabled());

        // The bypass wraps the subgraph read AND the render: Fusion (menus,
        // content collections) reads through the constrained subgraph, so the
        // constraints above stay authoritative for what becomes visible.
        return $this->securityContext->withoutAuthorizationChecks(function () use ($contentRepository, $nodeAddress, $visibilityConstraints) {
            $subgraph = $contentRepository
                ->getContentGraph($nodeAddress->workspaceName)
                ->getSubgraph($nodeAddress->dimensionSpacePoint, $visibilityConstraints);

            $nodeInstance = $subgraph->findNodeById($nodeAddress->aggregateId);
            if ($nodeInstance === null) {
                // The document has meanwhile been deleted or hidden in this
                // workspace; the link is intact but there is nothing to show.
                $this->throwStatus(404, 'The shared page is no longer available.');
            }

            $site = $subgraph->findClosestNode(
                $nodeAddress->aggregateId,
                FindClosestNodeFilter::create(nodeTypes: NodeTypeNameFactory::NAME_SITE)
            );
            if ($site === null) {
                $this->throwStatus(404, 'The shared page is no longer available.');
            }

            // Capability-URL hygiene: never cached or indexed, and the token
            // must not leak through the Referer header of any link the
            // previewed page happens to contain.
            $this->response->setHttpHeader('Cache-Control', 'no-store');
            $this->response->setHttpHeader('X-Robots-Tag', 'noindex, nofollow');
            $this->response->setHttpHeader('Referrer-Policy', 'no-referrer');

            $this->view->setOption('renderingModeName', RenderingMode::FRONTEND);
            $this->view->assignMultiple([
                'value' => $nodeInstance,
                'site' => $site,
            ]);

            $result = $this->view->render();
            if ($result instanceof ResponseInterface) {
                // A returned response replaces $this->response - re-apply.
                return $result
                    ->withHeader('Cache-Control', 'no-store')
                    ->withHeader('X-Robots-Tag', 'noindex, nofollow')
                    ->withHeader('Referrer-Policy', 'no-referrer');
            }

            return $result;
        });
    }
}
