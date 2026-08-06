<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Controller\Api;

use Medienreaktor\NeosApi\Controller\Api\AbstractApiController;
use Medienreaktor\NeosApi\Service\NodeAddressCodec;
use Medienreaktor\NeosApi\Service\WorkspaceSerializer;
use Medienreaktor\NeosStudio\Domain\Model\PreviewLink;
use Medienreaktor\NeosStudio\Service\PreviewLinkService;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\Model\User;
use Neos\Neos\Domain\Service\UserService;

/**
 * Mint and manage shareable preview links (the anonymous consumption side is
 * the ShareController). Strictly per-user like the notifications: the listing
 * and revocation only ever operate on the authenticated user's own links.
 *
 * A link can never grant more than its creator could see: minting requires
 * read access on the target workspace, checked here at creation time.
 */
class PreviewLinksController extends AbstractApiController
{
    #[Flow\Inject]
    protected PreviewLinkService $previewLinkService;

    #[Flow\Inject]
    protected WorkspaceSerializer $workspaceSerializer;

    #[Flow\Inject]
    protected UserService $userService;

    /**
     * GET /api/preview-links - the authenticated user's active links
     */
    public function indexAction(): string
    {
        $this->requireScope('neos.read');
        $user = $this->requireUser();

        return $this->json([
            'links' => array_map(
                $this->serializeLink(...),
                $this->previewLinkService->findLinksOf($user->getId())
            ),
        ]);
    }

    /**
     * POST /api/preview-links - body: {"node": "<address>", "label"?: "...", "ttlHours"?: 48}
     *
     * Responds with the link plus its "shareUrl" - the only time the URL is
     * available: the secret is stored hashed, re-reading it is impossible by
     * design. CSRF skipped like all unsafe bearer-token endpoints.
     */
    #[Flow\SkipCsrfProtection]
    public function createAction(): string
    {
        $this->requireScope('neos.write');
        $user = $this->requireUser();

        $body = json_decode((string)$this->request->getHttpRequest()->getBody(), true);
        if (!is_array($body) || !is_string($body['node'] ?? null)) {
            $this->throwJsonStatus(400, 'invalid_request', 'Request body must be a JSON object with a "node" address.');
        }
        $address = $this->decodeNodeAddress($body['node']);

        if (!$this->workspaceSerializer->canRead($this->getContentRepositoryId(), $address->workspaceName)) {
            $this->throwJsonStatus(403, 'insufficient_workspace_permissions', sprintf('You lack read access on workspace "%s".', $address->workspaceName->value));
        }
        // The link pins a document; a dangling address would only ever 404.
        // Frontend visibility deliberately NOT required: a currently disabled
        // page may well be shared to be seen once it is enabled.
        $node = $this->getSubgraph($address)->findNodeById($address->aggregateId);
        if ($node === null) {
            $this->throwJsonStatus(404, 'node_not_found', 'The node does not exist in this workspace and dimension.');
        }

        $label = trim(is_string($body['label'] ?? null) ? $body['label'] : '');
        $ttlHours = $body['ttlHours'] ?? null;
        if ($ttlHours !== null && (!is_int($ttlHours) || $ttlHours < 1)) {
            $this->throwJsonStatus(400, 'invalid_ttl', '"ttlHours" must be a positive integer.');
        }

        ['link' => $link, 'secret' => $secret] = $this->previewLinkService->createLink(
            $address,
            $label,
            $ttlHours !== null ? new \DateInterval(sprintf('PT%dH', $ttlHours)) : null,
            $user->getId()
        );

        return $this->json([
            'link' => $this->serializeLink($link) + ['shareUrl' => $this->shareUrl($secret)],
        ], 201);
    }

    /**
     * DELETE /api/preview-links/{linkId} - revoke one of the own links.
     * CSRF skipped like all unsafe bearer-token endpoints.
     */
    #[Flow\SkipCsrfProtection]
    public function deleteAction(string $linkId): string
    {
        $this->requireScope('neos.write');
        $user = $this->requireUser();

        if (!$this->previewLinkService->revokeLink($linkId, $user->getId())) {
            // Foreign ids are reported as non-existent, not as forbidden.
            $this->throwJsonStatus(404, 'link_not_found', 'No such preview link.');
        }

        return $this->json(['revoked' => $linkId]);
    }

    private function requireUser(): User
    {
        $user = $this->userService->getCurrentUser();
        if ($user === null) {
            // client_credentials tokens act as an account without a Neos user;
            // links are per-user (listing, revocation), so one is required.
            $this->throwJsonStatus(403, 'no_user', 'Preview links require a token bound to a Neos user.');
        }

        return $user;
    }

    private function shareUrl(string $secret): string
    {
        $uri = $this->request->getHttpRequest()->getUri();

        return $uri->getScheme() . '://' . $uri->getAuthority() . '/neos/studio/share/' . $secret;
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeLink(PreviewLink $link): array
    {
        return [
            'id' => $link->id,
            'label' => $link->label,
            'node' => NodeAddressCodec::encode($link->nodeAddress()),
            'workspaceName' => $link->workspaceName->value,
            'createdAt' => $link->createdAt->format(\DateTimeInterface::ATOM),
            'expiresAt' => $link->expiresAt->format(\DateTimeInterface::ATOM),
        ];
    }
}
