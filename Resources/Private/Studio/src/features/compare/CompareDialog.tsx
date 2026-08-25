import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addressInDimension,
  addressInWorkspace,
  addressWithAggregateId,
  decodeNodeAddress,
} from '@/api/nodeAddress'
import {
  dimensionSpacePointEquals,
  dimensionSpacePointLabel,
  useDimensions,
  type DimensionSpacePoint,
} from '@/api/dimensions'
import {
  useWorkspaceDocumentDiff,
  type Workspace,
  type WorkspaceDocumentChange,
  type WorkspaceDocumentDiffNode,
} from '@/api/workspaces'
import { useStudio } from '@/app/StudioContext'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Placeholder } from '@/components/ui/placeholder'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { FaIcon } from '@/features/tree/nodeTypeIcon'
import { ConflictResolutionDialog } from '@/features/workspaces/ConflictResolutionDialog'
import {
  ChangeBadges,
  workspaceLabel,
} from '@/features/workspaces/changeDisplay'
import {
  TONE_BG_CLASSES,
  type ChangeTone,
} from '@/features/workspaces/historyLabels'
import { ChangeRow } from '@/features/workspaces/StepDiff'
import { useWorkspacePublishing } from '@/features/workspaces/useWorkspacePublishing'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { ComparePane, type ComparePaneHandle } from './ComparePane'
import type { CompareMark, CompareMetrics, CompareStatus } from './protocol'
import { pairAnchors, projectScroll } from './scrollSync'

/**
 * Side-by-side review of one workspace against its base: the page as it is
 * live on the left, as it would be after publishing on the right, with every
 * changed element marked in both.
 *
 * It answers the question the change list cannot - "does this look right?" -
 * by putting the two rendered versions next to each other instead of listing
 * property values. The frames are ordinary Studio previews of the same
 * document in two workspaces (see ComparePane); everything that makes them a
 * diff happens here:
 *
 * - the changed nodes come from the document-diff resource and are pushed
 *   into both frames as marks; each frame paints the ones it renders, which
 *   is what puts a creation on the right and a removal on the left
 * - the frames report where their content elements sit, and those positions
 *   pair by aggregate id into a map between the two scroll positions - so
 *   scrolling one scrolls the other to the SAME CONTENT, however much the
 *   changes moved it (see scrollSync.ts)
 * - the changes form an ordered list to step through, jumping both frames to
 *   the element under review
 *
 * Publishing and discarding are right here, scoped to the document on screen:
 * reviewing page by page and deciding page by page is one motion.
 */

const STATUS_TONES: Record<CompareStatus, ChangeTone> = {
  created: 'add',
  removed: 'remove',
  moved: 'change',
  changed: 'change',
  variant: 'variant',
}

/** Badge captions of the marks - translated here, the frames carry no i18n. */
function statusLabel(status: CompareStatus): string {
  switch (status) {
    case 'created':
      return t('compare.mark.created', 'New')
    case 'removed':
      return t('compare.mark.removed', 'Removed')
    case 'moved':
      return t('compare.mark.moved', 'Moved')
    case 'variant':
      return t('compare.mark.variant', 'Variant')
    default:
      return t('compare.mark.changed', 'Changed')
  }
}

/** Room left above a change the navigation jumps to, so it is not glued to the top. */
const JUMP_OFFSET = 96
/**
 * A scroll this frame was told to perform reports back as an ordinary scroll
 * event. The frames filter their own echo, this is the second line of defence
 * against the two of them pushing each other down the page.
 */
const ECHO_WINDOW_MS = 150
const JUMP_ECHO_WINDOW_MS = 900
/**
 * See realignUntilRef: how long a jump keeps correcting itself. Long enough
 * to outlast the compare script's own settling measurements, which is what
 * reports the late layout shifts in the first place.
 */
const SETTLE_WINDOW_MS = 6000
/**
 * See scrollLockRef. A jump whose two sides disagree with the content map by
 * more than this holds its offset instead - only a moved element gets that far
 * apart, an ordinary change lands within a few pixels of the map.
 */
const LOCK_ENGAGE_PX = 120
/** ...and the hold is released once the map is back within this of it. */
const LOCK_RELEASE_PX = 60

type Side = 'base' | 'target'

/**
 * Stable identity of a dimension space point, for grouping and selection.
 * Sorted, so the same coordinates always produce the same key regardless of
 * how many dimensions a content repository configures or in which order the
 * projection happened to hand them over.
 */
function dimensionKey(point: DimensionSpacePoint): string {
  return Object.keys(point)
    .sort()
    .map((name) => `${name}=${point[name]}`)
    .join('&')
}

export function CompareDialog({
  open,
  onOpenChange,
  source,
  workspaces,
  documents,
  initialDocumentId,
  canNavigate,
  onOpenPage,
  onPublished,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The workspace under review - the right-hand ("after") side. */
  source: Workspace
  /** Every readable workspace, for resolving the base workspace's label. */
  workspaces: Workspace[]
  /** The changed documents of `source`, as the review dialog lists them. */
  documents: WorkspaceDocumentChange[]
  /** The document to open on; falls back to the first changed one. */
  initialDocumentId: string | null
  /** Whether showing a document in its workspace is possible at all. */
  canNavigate: boolean
  /** Leave the comparison and open the document for editing. */
  onOpenPage: (address: string) => void
  /** A publish went out for this workspace (the tasks board completes tasks). */
  onPublished?: (sourceWorkspaceName: string) => void
}) {
  const targetWorkspaceName = source.baseWorkspace
  const sourceLabel = workspaceLabel(source, source.name)
  const baseLabel = targetWorkspaceName
    ? workspaceLabel(
        workspaces.find((w) => w.name === targetWorkspaceName),
        targetWorkspaceName,
      )
    : t('workspace.baseWorkspaceFallback', 'the base workspace')

  const [documentId, setDocumentId] = useState<string | null>(initialDocumentId)
  const [syncScroll, setSyncScroll] = useState(true)
  const [activeChange, setActiveChange] = useState(-1)
  /**
   * The before/after values of the change under review, below the frames. On
   * by default: a rendered page can only ever show the changes it renders, and
   * the reviewer has no way of telling which of the two kinds they are looking
   * at unless the values are there to read.
   */
  const [showDetails, setShowDetails] = useState(true)

  // Every open starts on the requested document; a closed dialog carries no
  // stale comparison into the next one.
  useEffect(() => {
    if (open) {
      setDocumentId(
        initialDocumentId ?? documents[0]?.documentAggregateId ?? null,
      )
      setActiveChange(-1)
    }
  }, [open, initialDocumentId])

  const document =
    documents.find((d) => d.documentAggregateId === documentId) ?? null

  const { selectedDocument } = useStudio()
  // A deleted page has no address of its own (it is gone as far as every
  // other resource is concerned), yet it is exactly the page a reviewer wants
  // to look at before approving its removal. Its identity in the BASE
  // workspace is derived from a sibling address: same content repository, same
  // dimension, the deleted aggregate id. Best effort - if the deletion
  // happened in another dimension than the one on screen, the base frame
  // reports it could not render, which is what the fallback state is for.
  const addressTemplate =
    selectedDocument?.address ??
    documents.find((d) => d.documentAddress !== null)?.documentAddress ??
    null

  /** The dimension the reviewer is working in, if one is on screen. */
  const activeDimension = useMemo(
    () =>
      selectedDocument === null
        ? null
        : decodeNodeAddress(selectedDocument.address).dimensionSpacePoint,
    [selectedDocument],
  )

  const { data: diff, isLoading: diffLoading } = useWorkspaceDocumentDiff(
    source.name,
    documentId,
    open,
  )
  const { data: dimensionsData } = useDimensions(open)
  const dimensions = dimensionsData?.dimensions ?? []

  /**
   * The document's changes, grouped by the dimension they were made in.
   *
   * A page exists once per dimension space point, and it is edited once per
   * dimension space point: the same headline can be changed in German and left
   * alone in English, an element can be moved in one language only. The diff
   * reports every one of those separately, with the coordinates it originated
   * in - so a comparison that ignores them paints German changes onto the
   * English page and counts one edit twice. Which version is under review has
   * to be a decision, and this is what there is to decide between.
   *
   * Grouping is on the full coordinate, not on the language: a repository with
   * language AND market has four pages behind one document, and "German" alone
   * does not name any of them.
   */
  const dimensionGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string
        point: DimensionSpacePoint
        nodes: WorkspaceDocumentDiffNode[]
      }
    >()
    for (const node of diff?.nodes ?? []) {
      const key = dimensionKey(node.dimensions)
      const group = groups.get(key)
      if (group) group.nodes.push(node)
      else groups.set(key, { key, point: node.dimensions, nodes: [node] })
    }
    return [...groups.values()]
  }, [diff])

  const [dimensionSelection, setDimensionSelection] = useState<string | null>(
    null,
  )
  // Another document, another set of dimensions - an explicit pick does not
  // carry over to a page that may not even have changes there.
  useEffect(() => setDimensionSelection(null), [documentId])

  /**
   * The version under review: what the reviewer picked, else the dimension
   * they are working in (they just edited it - that is the one they mean),
   * else the one carrying the most changes.
   */
  const activeGroup = useMemo(() => {
    if (dimensionGroups.length === 0) return null
    const picked = dimensionGroups.find(
      (group) => group.key === dimensionSelection,
    )
    if (picked) return picked
    const own =
      activeDimension === null
        ? undefined
        : dimensionGroups.find((group) =>
            dimensionSpacePointEquals(group.point, activeDimension),
          )
    if (own) return own
    return [...dimensionGroups].sort(
      (a, b) => b.nodes.length - a.nodes.length,
    )[0]
  }, [dimensionGroups, dimensionSelection, activeDimension])

  /**
   * The dimension both frames render. The changes decide it, not the editing
   * context: a reviewer looking at a page whose only changes are English must
   * be shown the English page, or there is nothing to review.
   */
  const renderedDimension = activeGroup?.point ?? activeDimension
  const inRenderedDimension = (address: string) =>
    renderedDimension === null
      ? address
      : addressInDimension(address, renderedDimension)

  const baseAddress = useMemo(() => {
    if (!document || targetWorkspaceName === null) return null
    // Created here - there is nothing on the other side to compare against.
    if (document.created) return null
    const address =
      document.documentAddress ??
      (addressTemplate === null
        ? null
        : addressWithAggregateId(addressTemplate, document.documentAggregateId))
    return address === null
      ? null
      : addressInWorkspace(inRenderedDimension(address), targetWorkspaceName)
    // inRenderedDimension is derived from renderedDimension.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, targetWorkspaceName, addressTemplate, renderedDimension])

  // The reviewed version. A page deleted in this workspace has none.
  const targetAddress =
    document && !document.deleted && document.documentAddress !== null
      ? inRenderedDimension(document.documentAddress)
      : null

  // Only the changes of the rendered dimension: a change made in another one
  // belongs to another version of this page and has no business being marked
  // on this one.
  const changedNodes = activeGroup?.nodes ?? []

  const marks = useMemo<CompareMark[]>(
    () =>
      changedNodes.map((node) => ({
        aggregateId: node.nodeAggregateId,
        status: node.status,
        label: statusLabel(node.status),
        // What the frames mark for the page node itself: its element is the
        // whole page, its properties are what changed (see the protocol).
        // Only for an edit: a page created here has every property in its
        // diff, and outlining all of them would paint the whole new page
        // green - which the "new page" panel on the other side already says.
        properties:
          node.status === 'changed'
            ? node.changes
                .filter((change) => change.kind === 'property')
                .map((change) => change.property)
                .filter((property): property is string => property !== null)
            : [],
      })),
    [changedNodes],
  )

  const baseRef = useRef<ComparePaneHandle>(null)
  const targetRef = useRef<ComparePaneHandle>(null)
  const [baseMetrics, setBaseMetrics] = useState<CompareMetrics | null>(null)
  const [targetMetrics, setTargetMetrics] = useState<CompareMetrics | null>(
    null,
  )

  // Fresh frames for a fresh document - the old page's geometry must not
  // survive into the new comparison.
  // A new page or a new dimension means new frames - the old geometry must
  // not survive into a comparison of something else.
  const renderKey = `${documentId ?? ''}|${activeGroup?.key ?? ''}`
  useEffect(() => {
    setBaseMetrics(null)
    setTargetMetrics(null)
    setActiveChange(-1)
    scrollLockRef.current = null
  }, [renderKey])

  const handles: Record<Side, React.RefObject<ComparePaneHandle | null>> = {
    base: baseRef,
    target: targetRef,
  }
  const metrics: Record<Side, CompareMetrics | null> = {
    base: baseMetrics,
    target: targetMetrics,
  }
  // The scroll handlers read these on every event; state alone would hand
  // them the values of the render they were created in.
  const metricsRef = useRef(metrics)
  metricsRef.current = metrics
  const syncRef = useRef(syncScroll)
  syncRef.current = syncScroll
  const echoUntilRef = useRef<Record<Side, number>>({ base: 0, target: 0 })
  /**
   * How long after a jump the frames keep correcting themselves. A page is
   * not done laying out when its first metrics arrive: hero images decode,
   * web fonts swap in, lazy blocks resolve - and every one of them moves the
   * content BELOW it, including the change that was just scrolled to. Without
   * this the jump lands correctly and then quietly slides away, and the two
   * versions end up showing different parts of the page. The window closes
   * early the moment the reviewer scrolls themselves.
   */
  const realignUntilRef = useRef(0)
  /**
   * The offset the two frames are deliberately held at, or null for ordinary
   * content synchronization.
   *
   * A MOVED element is in two different places, so there is no scroll position
   * that shows it on both sides at once - the change navigation therefore puts
   * each frame on its own copy, which by definition disagrees with the content
   * map. Left alone, the reviewer's first nudge of the wheel would ask the map
   * where the other frame belongs and hurl it a screen and a half away, right
   * as they were looking at the two versions of the section. So the offset the
   * jump established is held instead, and released again the moment the map
   * agrees with it - which happens by itself as they scroll out of the moved
   * region.
   */
  const scrollLockRef = useRef<number | null>(null)

  const anchorPairs = useMemo(() => {
    if (!baseMetrics || !targetMetrics) return null
    return {
      base: pairAnchors(baseMetrics, targetMetrics),
      target: pairAnchors(targetMetrics, baseMetrics),
    }
  }, [baseMetrics, targetMetrics])
  const pairsRef = useRef(anchorPairs)
  pairsRef.current = anchorPairs

  const scrollFrame = (side: Side, scrollTop: number, smooth: boolean) => {
    echoUntilRef.current[side] =
      performance.now() + (smooth ? JUMP_ECHO_WINDOW_MS : ECHO_WINDOW_MS)
    handles[side].current?.scrollTo(Math.round(scrollTop), smooth)
  }

  const handleScroll = (side: Side, scrollTop: number) => {
    if (performance.now() < echoUntilRef.current[side]) return
    // A scroll of the reviewer's own hands ends the settling window below -
    // from here on, where they left the page is where it stays.
    realignUntilRef.current = 0
    if (!syncRef.current) return
    const other: Side = side === 'base' ? 'target' : 'base'
    const from = metricsRef.current[side]
    const to = metricsRef.current[other]
    const pairs = pairsRef.current?.[side]
    if (!from || !to || !pairs) return
    const projected = projectScroll(from, to, pairs, scrollTop)
    const lock = scrollLockRef.current
    if (lock === null) {
      scrollFrame(other, projected, false)
      return
    }
    // Held at the offset a jump onto a moved element established, until the
    // content map catches up with it again.
    const held = side === 'base' ? scrollTop + lock : scrollTop - lock
    if (Math.abs(projected - held) <= LOCK_RELEASE_PX) {
      scrollLockRef.current = null
      scrollFrame(other, projected, false)
      return
    }
    scrollFrame(other, held, false)
  }

  /**
   * The changes to step through, ordered the way the reviewed page reads.
   * Changes rendered on one side only (a creation, a removal) are placed by
   * projecting their position into the reviewed page's coordinates, so they
   * sit between their neighbours instead of at either end.
   *
   * The positions come from where each frame actually PLACED its mark, not
   * from the content-element anchors: a page property is marked on its
   * rendered value somewhere in the middle of the page, while the page node's
   * own anchor sits at its top edge.
   *
   * Changes with no position at all stay in the list, at its end. They are the
   * ones a rendered page cannot show - an alt text, an SEO title, a link
   * target, a page property that renders nowhere - and dropping them would
   * turn "step through the changes" into "step through the visible ones",
   * which is the same as hiding them. They carry the diff rows every change
   * carries, and those rows are what the detail panel reads them out of.
   */
  const stops = useMemo(() => {
    const placedTops = (metrics: CompareMetrics | null) =>
      new Map(
        (metrics?.placements ?? [])
          .filter((placement) => placement.top !== null)
          .map((placement) => [placement.aggregateId, placement.top as number]),
      )
    const baseTops = placedTops(baseMetrics)
    const targetTops = placedTops(targetMetrics)
    const basePairs = anchorPairs?.base ?? []
    const entries = changedNodes.map((node) => {
      const baseTop = baseTops.get(node.nodeAggregateId) ?? null
      const targetTop = targetTops.get(node.nodeAggregateId) ?? null
      const order =
        targetTop ??
        (baseTop !== null && baseMetrics && targetMetrics
          ? projectScroll(baseMetrics, targetMetrics, basePairs, baseTop)
          : null)
      return {
        node,
        aggregateId: node.nodeAggregateId,
        baseTop,
        targetTop,
        order,
      }
    })
    return [
      ...entries
        .filter((entry) => entry.order !== null)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      ...entries.filter((entry) => entry.order === null),
    ]
  }, [changedNodes, baseMetrics, targetMetrics, anchorPairs])

  // The stops of the render the alignment runs in - it is called from effects
  // and timers that outlive it.
  const stopsRef = useRef(stops)
  stopsRef.current = stops
  const activeChangeRef = useRef(activeChange)
  activeChangeRef.current = activeChange

  /** Put a change under both frames' JUMP_OFFSET, each in its own page. */
  const alignToStop = (index: number, smooth: boolean) => {
    const stop = stopsRef.current[index]
    if (!stop) return
    const base = metricsRef.current.base
    const target = metricsRef.current.target
    const pairs = pairsRef.current
    // Each side scrolls to its own copy of the element - or, where it has
    // none, to where that element would be.
    let baseTop = stop.baseTop
    let targetTop = stop.targetTop
    if (baseTop === null && targetTop !== null && base && target && pairs) {
      baseTop = projectScroll(target, base, pairs.target, targetTop)
    }
    if (targetTop === null && baseTop !== null && base && target && pairs) {
      targetTop = projectScroll(base, target, pairs.base, baseTop)
    }
    const baseScroll =
      baseTop === null ? null : Math.max(0, baseTop - JUMP_OFFSET)
    const targetScroll =
      targetTop === null ? null : Math.max(0, targetTop - JUMP_OFFSET)
    if (baseScroll !== null) scrollFrame('base', baseScroll, smooth)
    if (targetScroll !== null) scrollFrame('target', targetScroll, smooth)

    // Does this landing disagree with the content map? Only a moved element
    // does - and then the offset it lands at is what the frames are held at
    // until the map catches up again (see scrollLockRef).
    scrollLockRef.current = null
    if (
      baseScroll === null ||
      targetScroll === null ||
      !base ||
      !target ||
      !pairs
    ) {
      return
    }
    const projected = projectScroll(base, target, pairs.base, baseScroll)
    if (Math.abs(projected - targetScroll) > LOCK_ENGAGE_PX) {
      scrollLockRef.current = targetScroll - baseScroll
    }
  }

  const goToStop = (index: number) => {
    const stop = stops[index]
    if (!stop) return
    setActiveChange(index)
    realignUntilRef.current = performance.now() + SETTLE_WINDOW_MS
    alignToStop(index, true)
    baseRef.current?.focus(stop.aggregateId)
    targetRef.current?.focus(stop.aggregateId)
  }

  // A frame re-measured itself: while the settling window is open, put the
  // change back where the jump left it.
  useEffect(() => {
    if (performance.now() > realignUntilRef.current) return
    if (activeChangeRef.current < 0) return
    alignToStop(activeChangeRef.current, false)
    // alignToStop reads refs only; re-running it on anything but fresh
    // measurements would fight the reviewer's own scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseMetrics, targetMetrics])

  // Land on the first change once both frames have reported in: a reviewer
  // opening a page came for the change, not for its header.
  const autoJumpedRef = useRef<string | null>(null)
  const framesSettled =
    (baseAddress === null || baseMetrics !== null) &&
    (targetAddress === null || targetMetrics !== null)
  /**
   * The frames have answered with the marks applied. Without this the jump
   * would fire on the first metrics - which arrive before the marks even
   * exist, so every change would still read as unplaced and the one jump the
   * reviewer gets would go nowhere.
   */
  const placementsReported =
    (baseAddress === null || (baseMetrics?.placements.length ?? 0) > 0) &&
    (targetAddress === null || (targetMetrics?.placements.length ?? 0) > 0)
  useEffect(() => {
    if (!open || documentId === null) return
    if (autoJumpedRef.current === renderKey) return
    if (!framesSettled || !placementsReported || stops.length === 0) return
    autoJumpedRef.current = renderKey
    goToStop(0)
    // goToStop reads refs; re-running on every stops change would fight the
    // reviewer's own navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, renderKey, framesSettled, placementsReported, stops.length])

  useEffect(() => {
    if (!open) autoJumpedRef.current = null
  }, [open])

  const { operation, resolve, pendingConflict, setPendingConflict } =
    useWorkspacePublishing(source.name)
  const busy = operation.isPending
  const canPublish = source.permissions.publish
  const canDiscard = source.permissions.write
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const run = (kind: 'publish' | 'discard') => {
    if (documentId === null) return
    operation.mutate(
      { kind, filter: { documents: [documentId] } },
      {
        onSuccess: () => {
          if (kind === 'publish') onPublished?.(source.name)
          // The document has no pending changes anymore - move on to the next
          // one, or leave when that was the last.
          const remaining = documents.filter(
            (d) => d.documentAggregateId !== documentId,
          )
          if (remaining.length === 0) onOpenChange(false)
          else setDocumentId(remaining[0].documentAggregateId)
        },
      },
    )
  }

  const changeCount = stops.length

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
        <DialogContent
          size="full"
          className="flex flex-col gap-0 overflow-hidden p-0"
        >
          <DialogHeader className="shrink-0 border-b border-neutral-200 px-4 py-3 pr-12 dark:border-neutral-800">
            <DialogTitle className="text-base">
              {t('compare.title', 'Compare changes')}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {t(
                'compare.description',
                '"{0}" as it is now, next to how "{1}" would publish it.',
                [baseLabel, sourceLabel],
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1">
            {/* The pages to walk through - reviewing is a sequence, not a
                single lookup, so the list stays in reach the whole time. */}
            <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800">
              <div className="shrink-0 border-b border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
                {documents.length === 1
                  ? t('compare.oneDocument', '1 changed page')
                  : t('compare.manyDocuments', '{0} changed pages', [
                      documents.length,
                    ])}
              </div>
              <ul className="flex-1 overflow-y-auto p-1">
                {documents.map((entry) => {
                  const id = entry.documentAggregateId
                  const isActive = id === documentId
                  const breadcrumb = entry.breadcrumb.slice(0, -1)
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => setDocumentId(id)}
                        className={cn(
                          'flex w-full cursor-pointer items-start gap-2 rounded-sm border border-transparent px-2 py-1.5 text-left transition-colors',
                          isActive
                            ? 'border-blue-500 bg-neutral-200 dark:bg-neutral-800'
                            : 'hover:bg-neutral-200 dark:hover:bg-neutral-800',
                        )}
                      >
                        <FaIcon
                          icon={entry.icon ?? 'fa-file'}
                          className={cn(
                            'mt-0.5 shrink-0 text-neutral-950 dark:text-white',
                            entry.hidden && 'opacity-50',
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block truncate text-sm',
                              entry.hidden && 'opacity-50',
                            )}
                          >
                            {entry.label}
                          </span>
                          {breadcrumb.length > 0 && (
                            <span className="block truncate text-[11px] text-neutral-600 dark:text-neutral-400">
                              {breadcrumb.join(' › ')}
                            </span>
                          )}
                          <ChangeBadges document={entry} className="mt-1" />
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
              {/* Change navigation, legend and the way out into the editor. */}
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
                <Button
                  size="icon-sm"
                  variant="secondary"
                  disabled={changeCount === 0}
                  title={t('compare.previousChange', 'Previous change')}
                  onClick={() =>
                    goToStop(
                      (activeChange <= 0 ? changeCount : activeChange) - 1,
                    )
                  }
                >
                  <i className="fas fa-chevron-up" aria-hidden />
                </Button>
                <Button
                  size="icon-sm"
                  variant="secondary"
                  disabled={changeCount === 0}
                  title={t('compare.nextChange', 'Next change')}
                  onClick={() => goToStop((activeChange + 1) % changeCount)}
                >
                  <i className="fas fa-chevron-down" aria-hidden />
                </Button>
                <span className="text-xs tabular-nums text-neutral-600 dark:text-neutral-400">
                  {diffLoading ? (
                    <Spinner className="text-xs" />
                  ) : changeCount === 0 ? (
                    t('compare.noChanges', 'No marked changes')
                  ) : (
                    t('compare.changePosition', 'Change {0} of {1}', [
                      Math.max(activeChange, 0) + 1,
                      changeCount,
                    ])
                  )}
                </span>
                {/* Which version of the page is under review. A document
                    changed in one dimension only still names it, so the
                    reviewer is never left guessing which language they are
                    looking at. */}
                {activeGroup !== null && (
                  <span className="ml-2 flex items-center gap-1.5">
                    <i
                      className="fas fa-globe text-xs text-neutral-500"
                      aria-hidden
                    />
                    {dimensionGroups.length > 1 ? (
                      <Select
                        value={activeGroup.key}
                        onValueChange={(value) =>
                          setDimensionSelection(value as string)
                        }
                        items={dimensionGroups.map((group) => ({
                          value: group.key,
                          label: dimensionSpacePointLabel(
                            group.point,
                            dimensions,
                          ),
                        }))}
                      >
                        <SelectTrigger
                          size="sm"
                          className="min-w-40"
                          title={t(
                            'compare.dimensionHint',
                            'This page exists once per dimension and is edited once per dimension — pick the version to review',
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {dimensionGroups.map((group) => (
                            <SelectItem key={group.key} value={group.key}>
                              {dimensionSpacePointLabel(
                                group.point,
                                dimensions,
                              )}
                              <span className="text-xs text-neutral-500 tabular-nums">
                                {group.nodes.length}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-neutral-600 dark:text-neutral-400">
                        {dimensionSpacePointLabel(
                          activeGroup.point,
                          dimensions,
                        )}
                      </span>
                    )}
                    {activeDimension !== null &&
                      !dimensionSpacePointEquals(
                        activeGroup.point,
                        activeDimension,
                      ) && (
                        <span
                          className="text-[11px] text-amber-600 dark:text-amber-400"
                          title={t(
                            'compare.otherDimensionHint',
                            'You are editing another dimension — this page has no changes there.',
                          )}
                        >
                          {t('compare.otherDimension', 'not your dimension')}
                        </span>
                      )}
                  </span>
                )}

                <span className="ml-2 flex flex-wrap items-center gap-2">
                  {(
                    [
                      'created',
                      'changed',
                      'moved',
                      'removed',
                    ] as CompareStatus[]
                  ).map((status) => (
                    <span
                      key={status}
                      className="flex items-center gap-1 text-[11px] text-neutral-600 dark:text-neutral-400"
                    >
                      <span
                        className={cn(
                          'size-2 rounded-full',
                          TONE_BG_CLASSES[STATUS_TONES[status]],
                        )}
                      />
                      {statusLabel(status)}
                    </span>
                  ))}
                </span>

                <span className="ml-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={showDetails ? 'secondary' : 'ghost'}
                    title={t(
                      'compare.detailsHint',
                      'Show the values this change replaced',
                    )}
                    onClick={() => setShowDetails((value) => !value)}
                  >
                    <i className="fas fa-fw fa-list-ul" aria-hidden />
                    {t('compare.details', 'Details')}
                  </Button>
                  <Button
                    size="sm"
                    variant={syncScroll ? 'secondary' : 'ghost'}
                    title={t(
                      'compare.syncScrollHint',
                      'Scroll both versions together',
                    )}
                    onClick={() => setSyncScroll((value) => !value)}
                  >
                    <i
                      className={`fas fa-fw ${syncScroll ? 'fa-link' : 'fa-link-slash'}`}
                      aria-hidden
                    />
                    {t('compare.syncScroll', 'Sync scrolling')}
                  </Button>
                  {canNavigate && targetAddress && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t('workspace.review.goToPage', 'Go to page')}
                      onClick={() => onOpenPage(targetAddress)}
                    >
                      <i
                        className="fas fa-fw fa-arrow-up-right-from-square"
                        aria-hidden
                      />
                      {t('compare.openPage', 'Open page')}
                    </Button>
                  )}
                </span>
              </div>

              {document === null ? (
                <Placeholder
                  icon="fa-code-compare"
                  title={t(
                    'compare.selectDocument',
                    'Pick a page on the left to compare it.',
                  )}
                />
              ) : (
                <div className="grid min-h-0 flex-1 grid-cols-2">
                  <div className="flex min-h-0 flex-col border-r border-neutral-200 dark:border-neutral-800">
                    <PaneHeader
                      caption={t('compare.beforeCaption', 'Before')}
                      workspace={baseLabel}
                    />
                    <ComparePane
                      ref={baseRef}
                      address={baseAddress}
                      marks={marks}
                      documentAggregateId={document.documentAggregateId}
                      emptyState={{
                        icon: 'fa-plus',
                        title: t(
                          'compare.emptyBase',
                          'This page is new — it does not exist in "{0}" yet.',
                          [baseLabel],
                        ),
                      }}
                      onMetrics={setBaseMetrics}
                      onScroll={(top) => handleScroll('base', top)}
                    />
                  </div>
                  <div className="flex min-h-0 flex-col">
                    <PaneHeader
                      caption={t('compare.afterCaption', 'After')}
                      workspace={sourceLabel}
                      tone="change"
                    />
                    <ComparePane
                      ref={targetRef}
                      address={targetAddress}
                      marks={marks}
                      documentAggregateId={document.documentAggregateId}
                      emptyState={{
                        icon: 'fa-trash-can',
                        title: t(
                          'compare.emptyTarget',
                          'This page will be removed from "{0}" when the changes are published.',
                          [baseLabel],
                        ),
                      }}
                      onMetrics={setTargetMetrics}
                      onScroll={(top) => handleScroll('target', top)}
                    />
                  </div>
                </div>
              )}

              {document !== null && showDetails && (
                <ChangeDetails
                  stop={
                    activeChange >= 0 ? (stops[activeChange] ?? null) : null
                  }
                  documentAggregateId={document.documentAggregateId}
                />
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <span className="mr-auto truncate text-xs text-neutral-600 dark:text-neutral-400">
              {document?.label}
            </span>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {t('action.close', 'Close')}
            </Button>
            <Button
              variant="destructive"
              disabled={documentId === null || !canDiscard || busy}
              onClick={() => setConfirmDiscard(true)}
            >
              <i className="fas fa-fw fa-trash-can" aria-hidden />
              {t('compare.discardDocument', 'Discard this page')}
            </Button>
            <Button
              disabled={documentId === null || !canPublish || busy}
              className={
                documentId !== null && canPublish
                  ? 'bg-green-500 text-white hover:bg-green-400 dark:hover:bg-green-600'
                  : undefined
              }
              onClick={() => run('publish')}
            >
              <i
                className={`fas fa-fw ${
                  busy && operation.variables?.kind === 'publish'
                    ? 'fa-spinner fa-spin'
                    : 'fa-arrow-up-from-bracket'
                }`}
                aria-hidden
              />
              {t('compare.publishDocument', 'Publish this page')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDiscard}
        onOpenChange={(next) => !next && setConfirmDiscard(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t(
                'workspace.review.discardOneTitle',
                'Discard changes on this document?',
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                'workspace.review.discardOneBody',
                'The pending changes on the selected document will be discarded. This cannot be undone.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmDiscard(false)}
            >
              {t('action.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDiscard(false)
                run('discard')
              }}
            >
              {t('workspace.discard.button', 'Discard')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConflictResolutionDialog
        open={pendingConflict !== null}
        conflicts={pendingConflict?.conflicts.conflicts ?? []}
        partial={
          pendingConflict?.conflicts.code === 'partial_publish_conflicts'
        }
        busy={resolve.isPending}
        onCancel={() => setPendingConflict(null)}
        onForce={() => resolve.mutate('force')}
        onDiscardAll={() => resolve.mutate('discardAll')}
        onNavigate={(address) => {
          setPendingConflict(null)
          onOpenPage(address)
        }}
      />
    </>
  )
}

/**
 * The values behind the change under review: one row per changed property,
 * old struck out, new below it - the same rows the review dialog lists.
 *
 * This is what makes the compare view complete rather than merely visual. Two
 * rendered pages can only ever show what they render: an alt text, a link
 * target, an SEO title, a boolean flag, an image swapped for another of the
 * same size - all of them are real changes that go live with the rest, and
 * none of them are visible in a screenshot of the page. Marked or not, every
 * change reads out here.
 */
function ChangeDetails({
  stop,
  documentAggregateId,
}: {
  stop: {
    node: WorkspaceDocumentDiffNode
    aggregateId: string
    order: number | null
  } | null
  documentAggregateId: string
}) {
  if (stop === null) {
    return (
      <div className="shrink-0 border-t border-neutral-200 px-4 py-3 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
        {t(
          'compare.selectChange',
          'Step through the changes to read what each one replaced.',
        )}
      </div>
    )
  }
  const { node } = stop
  // The page node's label is the page title, which reads as if the page itself
  // were the element - it is its settings that changed.
  const label =
    stop.aggregateId === documentAggregateId
      ? t('compare.pageProperties', 'Page properties')
      : (node.nodeLabel ?? node.nodeType ?? stop.aggregateId)
  return (
    <div className="flex max-h-[28vh] shrink-0 flex-col gap-2 overflow-y-auto border-t border-neutral-200 px-4 py-3 text-[11px] dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-neutral-950 dark:text-white',
            TONE_BG_CLASSES[STATUS_TONES[node.status]],
          )}
        >
          {statusLabel(node.status)}
        </span>
        <span className="truncate text-xs text-neutral-950 dark:text-white">
          {label}
        </span>
        {stop.order === null && (
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <i className="fas fa-eye-slash" aria-hidden />
            {t(
              'compare.noVisibleCounterpart',
              'Not visible on the page — only here',
            )}
          </span>
        )}
      </div>
      {node.changes.map((change, index) => (
        <ChangeRow key={index} change={change} />
      ))}
      {node.changes.length === 0 && (
        <div className="text-neutral-600 dark:text-neutral-400">
          {node.status === 'removed'
            ? t('compare.removedDetail', 'This element will be removed.')
            : t('workspaceHistory.noDetails', 'No details available.')}
        </div>
      )}
    </div>
  )
}

/** The strip naming which version a frame shows. */
function PaneHeader({
  caption,
  workspace,
  tone,
}: {
  caption: string
  workspace: string
  tone?: ChangeTone
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 bg-neutral-100 px-3 py-1.5 dark:border-neutral-800 dark:bg-neutral-900">
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-[11px] font-medium',
          tone
            ? `${TONE_BG_CLASSES[tone]} text-neutral-950 dark:text-white`
            : 'bg-neutral-300 text-neutral-950 dark:bg-neutral-700 dark:text-white',
        )}
      >
        {caption}
      </span>
      <span className="truncate text-xs text-neutral-600 dark:text-neutral-400">
        {workspace}
      </span>
    </div>
  )
}
