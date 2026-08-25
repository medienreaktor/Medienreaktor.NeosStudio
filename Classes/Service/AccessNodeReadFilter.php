<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

use Medienreaktor\NeosApi\Service\NodeReadFilterInterface;
use Neos\ContentRepository\Core\Projection\ContentGraph\ContentSubgraphInterface;
use Neos\ContentRepository\Core\Projection\ContentGraph\Node;
use Neos\Flow\Annotations as Flow;

/**
 * Drops nodes from the API's listings that the acting user's access roles put
 * out of reach entirely.
 *
 * This is what closes the one hole the client-side narrowing could not: the
 * document search returns matches from anywhere under the site, and a client
 * has no ancestry for a scattered hit to judge it by. Here the ancestry is one
 * subgraph query away.
 *
 * Only `hidden` nodes go. Pages that are merely outside a role but on the way
 * to one it grants stay in the listing - the tree needs them to navigate, and
 * the Studio renders them dimmed and locked. Dropping them would strand the
 * granted branch below with no path to it.
 *
 * Registered through Medienreaktor.NeosApi.nodeReadFilters, so the API never
 * learns what an access role is - the same seam the workspace data enrichers
 * use.
 */
#[Flow\Scope('singleton')]
class AccessNodeReadFilter implements NodeReadFilterInterface
{
    #[Flow\Inject]
    protected AccessControlService $accessControlService;

    /**
     * @param array<int, Node> $nodes
     * @return array<int, Node>
     */
    public function filterReadableNodes(array $nodes, ContentSubgraphInterface $subgraph): array
    {
        if ($nodes === []) {
            return $nodes;
        }
        $access = $this->accessControlService->effectiveAccessForCurrentUser();
        // Two ways out before the graph is touched at all, and between them
        // they cover nearly every request: an unrestricted account (everyone
        // without a role, and every administrator), and a role that narrows
        // by workspace, dimension or capability but not by WHERE a node sits -
        // which is the only thing a listing filter could act on.
        if ($access->unrestricted || !$access->narrowsByNodePosition()) {
            return $nodes;
        }

        $anchors = $this->accessControlService->pathAnchorsFor($access, $subgraph);

        return array_values(array_filter(
            $nodes,
            function (Node $node) use ($access, $subgraph, $anchors): bool {
                // The node is passed along so the resolver does not have to
                // look up what the caller already holds.
                [$idPath, $siteNodeName] = $this->accessControlService->nodeContext($subgraph, $node->aggregateId, $node);
                // An unresolvable node yields an empty context; leave it in
                // rather than losing a row for a reason nobody can see.
                if ($idPath === []) {
                    return true;
                }

                return $access->nodeVisibility($idPath, $siteNodeName, $anchors) !== 'hidden';
            }
        ));
    }
}
