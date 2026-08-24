<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Security;

use Medienreaktor\NeosStudio\Service\AccessControlService;
use Neos\ContentRepository\Core\Factory\AuthProviderFactoryInterface;
use Neos\ContentRepository\Core\Feature\Security\AuthProviderInterface;
use Neos\ContentRepository\Core\Projection\ContentGraph\ContentGraphReadModelInterface;
use Neos\ContentRepository\Core\SharedModel\ContentRepository\ContentRepositoryId;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\Service\WorkspaceService;
use Neos\Neos\Security\ContentRepositoryAuthProvider\ContentRepositoryAuthProviderFactory;

/**
 * Builds the {@see AccessControlAuthProvider} around Neos' own provider.
 *
 * Registered as the content repository's authProvider in Settings.yaml. Neos'
 * factory is asked for the delegate rather than duplicating its wiring, so
 * this stays correct as the core provider gains dependencies.
 *
 * @api
 */
#[Flow\Scope('singleton')]
final readonly class AccessControlAuthProviderFactory implements AuthProviderFactoryInterface
{
    public function __construct(
        private ContentRepositoryAuthProviderFactory $neosAuthProviderFactory,
        private AccessControlService $accessControlService,
        private WorkspaceService $workspaceService,
    ) {
    }

    public function build(ContentRepositoryId $contentRepositoryId, ContentGraphReadModelInterface $contentGraphReadModel): AuthProviderInterface
    {
        return new AccessControlAuthProvider(
            $contentRepositoryId,
            $this->neosAuthProviderFactory->build($contentRepositoryId, $contentGraphReadModel),
            $contentGraphReadModel,
            $this->accessControlService,
            $this->workspaceService,
        );
    }
}
