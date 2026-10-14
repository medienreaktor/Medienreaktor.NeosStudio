<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Controller\Api;

use Medienreaktor\NeosStudio\Service\NodeAddressCodec;
use Neos\ContentRepository\Core\ContentRepository;
use Neos\ContentRepository\Core\Projection\ContentGraph\ContentSubgraphInterface;
use Neos\ContentRepository\Core\Projection\ContentGraph\VisibilityConstraints;
use Neos\ContentRepository\Core\SharedModel\ContentRepository\ContentRepositoryId;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAddress;
use Neos\ContentRepositoryRegistry\ContentRepositoryRegistry;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\Mvc\Controller\ActionController;
use Neos\Neos\Domain\SubtreeTagging\NeosSubtreeTag;
use Neos\Neos\Domain\SubtreeTagging\NeosVisibilityConstraints;
use Neos\OAuth\Security\OAuthContext;

/**
 * Base class of the Studio's own JSON endpoints below /neos/studio/api.
 *
 * The content API itself is Neos.Api; these endpoints only serve what is
 * Studio-specific (tasks, notifications, access roles, preview links, the
 * review/history/trash read models). They share its authentication: the
 * Neos.OAuth:Bearer provider (see Settings.yaml) turns the access token into
 * the account, Flow policies (Policy.yaml) gate the actions by the account's
 * roles, and requireScope() narrows by the token's studio.* scopes.
 */
abstract class AbstractStudioApiController extends ActionController
{
    public const SCOPE_READ = 'studio.read';
    public const SCOPE_WRITE = 'studio.write';

    /**
     * @var array<string>
     */
    protected $supportedMediaTypes = ['application/json'];

    #[Flow\Inject]
    protected ContentRepositoryRegistry $contentRepositoryRegistry;

    #[Flow\Inject]
    protected OAuthContext $oauthContext;

    #[Flow\InjectConfiguration(path: 'contentRepository')]
    protected string $contentRepositoryId;

    private ?ContentRepository $contentRepository = null;

    private ?ContentRepositoryId $resolvedContentRepositoryId = null;

    protected function initializeAction(): void
    {
        $this->response->setContentType('application/json');
        // Every response is per-account, so it must never end up in a shared
        // cache - and an editing UI wants fresh data, so no client caching either.
        $this->response->setHttpHeader('Cache-Control', 'private, no-store');
        $this->response->setHttpHeader('Vary', 'Authorization');
    }

    protected function getContentRepository(): ContentRepository
    {
        return $this->contentRepository ??= $this->contentRepositoryRegistry->get($this->getContentRepositoryId());
    }

    protected function getContentRepositoryId(): ContentRepositoryId
    {
        return $this->resolvedContentRepositoryId ??= ContentRepositoryId::fromString($this->contentRepositoryId);
    }

    /**
     * The security-aware subgraph for a node address. With
     * $frontendVisibility, disabled ("hidden") nodes are excluded as well;
     * with $includeDeleted, soft-removed nodes become visible - only that one
     * tag is dropped from the account's constraints, never the constraints
     * themselves.
     */
    protected function getSubgraph(
        NodeAddress $address,
        bool $frontendVisibility = false,
        bool $includeDeleted = false
    ): ContentSubgraphInterface {
        $contentRepository = $this->getContentRepository();
        $subgraph = $contentRepository->getContentSubgraph($address->workspaceName, $address->dimensionSpacePoint);
        if (!$frontendVisibility && !$includeDeleted) {
            return $subgraph;
        }

        $constraints = $subgraph->getVisibilityConstraints();
        if ($frontendVisibility) {
            $constraints = $constraints->merge(NeosVisibilityConstraints::excludeDisabled());
        }
        if ($includeDeleted) {
            $constraints = VisibilityConstraints::excludeSubtreeTags(
                $constraints->excludedSubtreeTags->without(NeosSubtreeTag::removed())
            );
        }

        return $contentRepository->getContentGraph($address->workspaceName)
            ->getSubgraph($address->dimensionSpacePoint, $constraints);
    }

    protected function decodeNodeAddress(string $encoded): NodeAddress
    {
        try {
            $address = NodeAddressCodec::decode($encoded);
        } catch (\Throwable) {
            $this->throwJsonStatus(400, 'invalid_node_address', 'The given node address could not be parsed.');
        }
        if ($address->contentRepositoryId->value !== $this->contentRepositoryId) {
            $this->throwJsonStatus(400, 'invalid_node_address', sprintf('The node address belongs to content repository "%s", the Studio serves "%s".', $address->contentRepositoryId->value, $this->contentRepositoryId));
        }

        return $address;
    }

    /**
     * Narrow by the access token's scopes; the account's roles have already
     * been enforced by the Flow policy layer at this point.
     */
    protected function requireScope(string $scope): void
    {
        $grant = $this->oauthContext->authenticatedGrant();
        if ($grant === null) {
            $this->throwJsonStatus(401, 'unauthorized', 'No valid access token present.');
        }
        if (!$grant->hasScope($scope)) {
            $this->throwJsonStatus(403, 'insufficient_scope', sprintf('This request requires the "%s" scope.', $scope));
        }
    }

    /**
     * @param array<string, mixed> $data
     */
    protected function json(array $data, int $statusCode = 200): string
    {
        $this->response->setStatusCode($statusCode);

        return json_encode($data, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    /**
     * @param array<string, mixed> $details extra top-level fields merged into
     *        the error body (e.g. a structured "conflicts" list). Cannot
     *        override "error"/"error_description".
     */
    protected function throwJsonStatus(int $statusCode, string $error, string $description, array $details = []): never
    {
        $this->throwStatus($statusCode, null, json_encode([
            'error' => $error,
            'error_description' => $description,
        ] + $details, JSON_UNESCAPED_SLASHES));
    }
}
