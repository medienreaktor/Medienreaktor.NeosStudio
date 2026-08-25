import type { CompareMetrics } from './protocol'

/**
 * Keeping the two compare frames scrolled to the same CONTENT, not to the
 * same pixel. The versions of a page differ in height by exactly what the
 * changes added or removed, so a proportional scroll drifts apart the further
 * down the reviewer reads - and drifts most around the change they came to
 * look at.
 *
 * What both frames do share are the content elements they render: the same
 * node aggregate ids, at their own offsets. Those pairs are a piecewise
 * linear map from one frame's scroll position to the other's - anchored
 * exactly where content matches up, interpolated in between, and continued at
 * a constant offset above the first and below the last pair. Frames with no
 * element in common (a page created from scratch) fall back to proportional.
 */

/** One content element's position in both frames. */
export interface AnchorPair {
  from: number
  to: number
}

/**
 * The elements both frames render, as position pairs ordered by their position
 * in the source frame - reduced to the largest set that runs in the same
 * direction on both sides.
 *
 * A MOVED element is why this needs care. It sits near the top of one version
 * and near the bottom of the other, so its pair runs against the grain of
 * every other pair. Keeping it would bend the map around one outlier; walking
 * the list and dropping whatever comes out of order behind it is worse still,
 * because a section moved upwards contradicts every pair that follows it -
 * they all get dropped, the map ends at the move, and everything below it
 * projects off a single stale anchor. Which is exactly what a reviewer sees as
 * the other frame lurching away as they scroll.
 *
 * So the pairs are not filtered greedily but reduced to their longest strictly
 * increasing subsequence: the biggest set of elements that agree on the order
 * of the page. The moved element falls out as the outlier it is - unalignable
 * with itself by construction, since it is in two different places - and the
 * content around it stays anchored on both sides.
 */
export function pairAnchors(
  from: CompareMetrics,
  to: CompareMetrics,
): AnchorPair[] {
  const tops = new Map(
    to.anchors.map((anchor) => [anchor.aggregateId, anchor.top]),
  )
  // from.anchors arrives sorted by top (the compare script sorts it).
  const candidates: AnchorPair[] = []
  for (const anchor of from.anchors) {
    const partner = tops.get(anchor.aggregateId)
    if (partner === undefined) continue
    candidates.push({ from: anchor.top, to: partner })
  }
  return longestIncreasingRun(candidates)
}

/**
 * The longest subsequence whose `to` values strictly increase (patience
 * sorting, O(n log n)). `from` is already ascending, so the result runs
 * forward on both axes - which is what makes it a usable map.
 */
function longestIncreasingRun(candidates: AnchorPair[]): AnchorPair[] {
  if (candidates.length === 0) return []
  /** Index of the smallest tail of every run length found so far. */
  const tails: number[] = []
  /** Predecessor of each candidate in the run that ends at it. */
  const previous = new Array<number>(candidates.length).fill(-1)
  for (let index = 0; index < candidates.length; index++) {
    const value = candidates[index].to
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (candidates[tails[middle]].to < value) low = middle + 1
      else high = middle
    }
    if (low > 0) previous[index] = tails[low - 1]
    if (low === tails.length) tails.push(index)
    else tails[low] = index
  }
  const pairs: AnchorPair[] = []
  for (
    let index = tails[tails.length - 1];
    index >= 0;
    index = previous[index]
  ) {
    pairs.push(candidates[index])
  }
  return pairs.reverse()
}

/** The furthest a frame can be scrolled. */
function maxScroll(metrics: CompareMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.viewportHeight)
}

/**
 * The scroll position of the target frame that shows the same content as
 * `scrollTop` in the source frame.
 */
export function projectScroll(
  from: CompareMetrics,
  to: CompareMetrics,
  pairs: AnchorPair[],
  scrollTop: number,
): number {
  const limit = maxScroll(to)
  if (pairs.length === 0) {
    // Nothing in common - the best guess left is "the same way down".
    const fromLimit = maxScroll(from)
    if (fromLimit === 0) return 0
    return clamp((scrollTop / fromLimit) * limit, 0, limit)
  }

  const first = pairs[0]
  if (scrollTop <= first.from) {
    // Above the first shared element: whatever leads the page (a header) is
    // the same height in both, so keep the distance to it.
    return clamp(first.to - (first.from - scrollTop), 0, limit)
  }

  const last = pairs[pairs.length - 1]
  if (scrollTop >= last.from) {
    return clamp(last.to + (scrollTop - last.from), 0, limit)
  }

  // Between two shared elements: distribute proportionally over the content
  // between them, which is where an addition or removal sits.
  let low = 0
  let high = pairs.length - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (pairs[middle].from <= scrollTop) low = middle
    else high = middle
  }
  const start = pairs[low]
  const end = pairs[high]
  const span = end.from - start.from
  const ratio = span === 0 ? 0 : (scrollTop - start.from) / span
  return clamp(start.to + ratio * (end.to - start.to), 0, limit)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
