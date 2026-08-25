<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Domain\Model;

use Neos\ContentRepository\Core\DimensionSpace\DimensionSpacePoint;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAggregateId;

/**
 * What a {@see ReviewComment} is pinned to: one changed element, in one
 * version of one page.
 *
 * All three parts are needed to name a change. The node aggregate id alone
 * does not: the same element exists once per dimension space point and is
 * changed independently in each, so a comment on the German headline must not
 * surface on the English one. The document is carried along because the review
 * works page by page - it is what lets a page's comments be counted without
 * resolving every change first.
 */
final readonly class ReviewCommentAnchor
{
    public function __construct(
        public NodeAggregateId $documentAggregateId,
        public NodeAggregateId $nodeAggregateId,
        public DimensionSpacePoint $dimensionSpacePoint,
    ) {
    }
}
