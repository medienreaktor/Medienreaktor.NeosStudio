<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\PreviewLinks;

use Medienreaktor\NeosStudio\Endpoint\PreviewLinks\RequestBody\PreviewLinkCreate;
use Medienreaktor\NeosStudio\Endpoint\PreviewLinks\Response\PreviewLinkCreated;
use Medienreaktor\NeosStudio\Endpoint\PreviewLinks\Schema\NewPreviewLink;
use Medienreaktor\NeosStudio\Endpoint\PreviewLinks\Schema\PreviewLink;
use Medienreaktor\NeosStudio\Endpoint\PreviewLinks\Schema\PreviewLinkId;
use Medienreaktor\NeosStudio\Endpoint\PreviewLinks\Schema\PreviewLinkList;
use Medienreaktor\NeosStudio\Endpoint\PreviewLinks\Schema\PreviewLinkListing;
use Medienreaktor\NeosStudio\Security\StudioCallers;
use Medienreaktor\NeosStudio\Security\StudioScopes;
use Medienreaktor\NeosStudio\Service\PreviewLinkService;
use Neos\Api\Security\ApiAuthContextProvider;
use Neos\Api\Security\ApiCaller;
use Neos\Api\Shared\Response\Forbidden;
use Neos\Api\Shared\Response\NotFound;
use Neos\Api\Shared\Response\UnprocessableContent;
use Neos\ContentRepository\Core\ContentRepository;
use Neos\Neos\Domain\Model\User;
use Neos\OpenApi\Attributes\AuthContext;
use Neos\OpenApi\Attributes\Operation;
use Neos\OpenApi\Attributes\RequestBody;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The caller's preview links, which show one document to anybody with the
 * link (the anonymous side is the ShareController)
 *
 * Strictly the caller's own, like the notifications. A link never grants more
 * than its creator could see: creating one requires read access to the
 * workspace, and the node must exist there.
 */
final readonly class PreviewLinks
{
    public function __construct(
        private PreviewLinkService $previewLinkService,
        private StudioCallers $studioCallers,
    ) {
    }

    #[Operation(
        path: '/previewlinks',
        method: 'GET',
        summary: 'List your preview links',
        description: 'The caller\'s preview links that haven\'t expired, newest first. Their share URLs aren\'t included: only createPreviewLink returns one.',
        operationId: 'listPreviewLinks',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::PREVIEWLINKS_READ],
        ],
    )]
    public function list(#[AuthContext] ApiCaller $caller): PreviewLinkListing|Forbidden
    {
        $user = $this->studioCallers->requireUserOf($caller);
        if (!$user instanceof User) {
            return $user;
        }
        return PreviewLinkListing::of(new PreviewLinkList(
            ...array_map(PreviewLink::from(...), $this->previewLinkService->findLinksOf($user->getId())),
        ));
    }

    #[Operation(
        path: '/previewlinks',
        method: 'POST',
        summary: 'Create a preview link',
        description: 'A link that shows the document to anybody who has it, as the website would show it in the workspace and dimension space point (hidden pages included), until it expires. The response has the share URL, the only time it is readable. A workspace the caller may not read is a 403, a node or content repository that doesn\'t exist a 422.',
        operationId: 'createPreviewLink',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::PREVIEWLINKS_CREATE],
        ],
    )]
    public function create(
        #[AuthContext] ApiCaller $caller,
        #[RequestBody(description: 'The document and how long the link works')] PreviewLinkCreate $previewLink,
        ServerRequestInterface $request,
    ): PreviewLinkCreated|Forbidden|UnprocessableContent {
        $user = $this->studioCallers->requireUserOf($caller);
        if (!$user instanceof User) {
            return $user;
        }
        $contentRepository = $this->studioCallers->contentRepository($previewLink->contentRepositoryId);
        if (!$contentRepository instanceof ContentRepository) {
            return UnprocessableContent::because(sprintf('There is no content repository %s', $previewLink->contentRepositoryId->value));
        }
        $address = $previewLink->nodeAddress();
        if ($previewLink->ttlHours !== null && $previewLink->ttlHours < 1) {
            return UnprocessableContent::because('ttlHours must be at least 1');
        }
        if (!$this->studioCallers->permissionsOf($caller, $address->contentRepositoryId, $address->workspaceName)->read) {
            return Forbidden::because(sprintf('You may not read the workspace %s', $address->workspaceName->value));
        }
        $node = $contentRepository
            ->getContentSubgraph($address->workspaceName, $address->dimensionSpacePoint)
            ->findNodeById($address->aggregateId);
        if ($node === null) {
            return UnprocessableContent::because(sprintf('There is no node %s in the workspace %s and dimension space point %s', $address->aggregateId->value, $address->workspaceName->value, $address->dimensionSpacePoint->toJson()));
        }
        ['link' => $link, 'secret' => $secret] = $this->previewLinkService->createLink(
            $address,
            trim($previewLink->label ?? ''),
            $previewLink->ttlHours !== null ? new \DateInterval(sprintf('PT%dH', $previewLink->ttlHours)) : null,
            $user->getId(),
        );
        $uri = $request->getUri();
        return new PreviewLinkCreated(NewPreviewLink::of(
            PreviewLink::from($link),
            $uri->getScheme() . '://' . $uri->getAuthority() . '/neos/studio/share/' . $secret,
        ));
    }

    #[Operation(
        path: '/previewlinks/{previewLinkId}',
        method: 'DELETE',
        summary: 'Revoke a preview link',
        description: 'The link stops working at once. A link of another user is a 404, as an unknown one.',
        operationId: 'deletePreviewLink',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::PREVIEWLINKS_DELETE],
        ],
    )]
    public function delete(#[AuthContext] ApiCaller $caller, PreviewLinkId $previewLinkId): Forbidden|NotFound|null
    {
        $user = $this->studioCallers->requireUserOf($caller);
        if (!$user instanceof User) {
            return $user;
        }
        if (!$this->previewLinkService->revokeLink($previewLinkId->value, $user->getId())) {
            return NotFound::because(sprintf('You have no preview link with the ID %s', $previewLinkId->value));
        }
        return null;
    }
}
