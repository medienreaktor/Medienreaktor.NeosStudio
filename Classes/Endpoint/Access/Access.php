<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Access;

use Medienreaktor\NeosStudio\Domain\Model\AccessRole;
use Medienreaktor\NeosStudio\Endpoint\Access\Schema\EffectiveAccessRole;
use Medienreaktor\NeosStudio\Endpoint\Access\Schema\EffectiveAccessRoleList;
use Medienreaktor\NeosStudio\Endpoint\Access\Schema\MyAccess;
use Medienreaktor\NeosStudio\Endpoint\AccessRoles\Schema\AccessCapabilityList;
use Medienreaktor\NeosStudio\Security\StudioCallers;
use Medienreaktor\NeosStudio\Security\StudioScopes;
use Medienreaktor\NeosStudio\Service\AccessControlService;
use Neos\Api\Security\AccountPrivileges;
use Neos\Api\Security\ApiAuthContextProvider;
use Neos\Api\Security\ApiCaller;
use Neos\ContentRepository\Core\DimensionSpace\DimensionSpacePoint;
use Neos\ContentRepository\Core\Projection\ContentGraph\ContentSubgraphInterface;
use Neos\ContentRepository\Core\Projection\ContentGraph\VisibilityConstraints;
use Neos\ContentRepository\Core\SharedModel\ContentRepository\ContentRepositoryId;
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\ContentRepositoryRegistry\ContentRepositoryRegistry;
use Neos\Neos\Domain\Repository\SiteRepository;
use Neos\OpenApi\Attributes\AuthContext;
use Neos\OpenApi\Attributes\Operation;

/**
 * The caller's own access: where their access roles let them work
 *
 * Every editor may read it: it only describes the restrictions they work
 * within anyway, and the Studio needs it to shape its UI. Administering the
 * roles is AccessRoles.
 */
final readonly class Access
{
    public function __construct(
        private AccessControlService $accessControlService,
        private AccountPrivileges $accountPrivileges,
        private StudioCallers $studioCallers,
        private SiteRepository $siteRepository,
        private ContentRepositoryRegistry $contentRepositoryRegistry,
    ) {
    }

    #[Operation(
        path: '/access/me',
        method: 'GET',
        summary: 'Get your access',
        description: 'Where the caller\'s access roles let them work, role by role, with the capabilities a role can withhold and whether the caller may administer the roles. Administrators and users without an access role are unrestricted (unless restrictUnassignedUsers is configured).',
        operationId: 'getMyAccess',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::ACCESS_READ],
        ],
    )]
    public function me(#[AuthContext] ApiCaller $caller): MyAccess
    {
        $access = $this->accessControlService->effectiveAccessFor(
            $this->accountPrivileges->rolesOf($caller->account),
            $this->studioCallers->userOf($caller)?->getId(),
        );
        return new MyAccess(
            $access->unrestricted,
            $access->reason,
            new EffectiveAccessRoleList(...array_map(
                static fn (AccessRole $role) => EffectiveAccessRole::from($role),
                $access->roles,
            )),
            array_values($this->accessControlService->pathAnchorsFor($access, $this->liveSubgraphOfSite(...))),
            AccessCapabilityList::all(),
            $this->accountPrivileges->isGranted($caller->account, StudioScopes::ACCESSROLES_UPDATE_PRIVILEGE),
        );
    }

    /**
     * The live subgraph of the site's content repository, in its first root
     * dimension space point - ancestry is what is read from it, which doesn't
     * meaningfully differ between dimensions. null for an unknown site
     *
     * Deliberately WITHOUT visibility constraints: a hidden (or soft-removed)
     * page is still a row in the page tree, so it still has to count as a path
     * anchor, or the allowed branch below it would be stranded. Nothing leaks:
     * anchors only decide whether a row is drawn, never what it contains.
     */
    private function liveSubgraphOfSite(string $siteNodeName): ?ContentSubgraphInterface
    {
        try {
            $site = $this->siteRepository->findOneByNodeName($siteNodeName);
        } catch (\InvalidArgumentException) {
            return null;
        }
        if ($site === null) {
            return null;
        }
        return $this->liveSubgraphOf($site->getConfiguration()->contentRepositoryId);
    }

    private function liveSubgraphOf(ContentRepositoryId $contentRepositoryId): ContentSubgraphInterface
    {
        $contentRepository = $this->contentRepositoryRegistry->get($contentRepositoryId);
        $dimensionSpacePoint = array_values($contentRepository->getVariationGraph()->getRootGeneralizations())[0]
            ?? DimensionSpacePoint::createWithoutDimensions();

        return $contentRepository
            ->getContentGraph(WorkspaceName::forLive())
            ->getSubgraph($dimensionSpacePoint, VisibilityConstraints::createEmpty());
    }
}
