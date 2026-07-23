import { memo, useCallback, useMemo, useRef, useState } from 'react'
import {
  useWorkspaces,
  useWorkspacesPendingEvents,
  type Workspace,
  type WorkspacePendingEvent,
} from '@/api/workspaces'
import { useStudio } from '@/app/StudioContext'
import {
  GraphCanvas,
  type GraphCanvasHandle,
} from '@/components/graph/GraphCanvas'
import { cardSurface, SELECTED_RING } from '@/components/graph/cardStyle'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LoadingState } from '@/components/ui/spinner'
import { faClassName } from '@/features/tree/nodeTypeIcon'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { ConflictResolutionDialog } from './ConflictResolutionDialog'
import { ReviewChangesDialog } from './ReviewChangesDialog'
import { useWorkspaceSync } from './useWorkspaceSync'
import {
  baseChainOf,
  buildWorkspaceGraph,
  BRANCH_BEND,
  DOT_SPACING,
  WS_CARD_HEIGHT,
  WS_CARD_WIDTH,
  type WorkspaceBranch,
  type WorkspaceGraph,
} from './workspaceGraphModel'

/**
 * The Workspaces panel: every workspace as a git-style branch off the current
 * published live state, with its pending changes (the ESCR events recorded
 * since it forked off its base) as commit dots along the branch line - a
 * Sourcetree-like picture of "who has built what on top of live". Drawn on
 * the shared GraphCanvas; polls while visible so edits elsewhere appear.
 */

/** Poll cadence while the panel is actually visible. */
const REFRESH_INTERVAL = 30_000
const DOT_RADIUS = 6

/**
 * Human labels for the event types the feed surfaces, resolved at render time
 * (module-level t() would run before the XLIFF catalog is loaded).
 */
const EVENT_TYPE_LABELS: Record<string, () => string> = {
  NodePropertiesWereSet: () =>
    t('workspaceGraph.event.propertiesChanged', 'Properties changed'),
  NodeReferencesWereSet: () =>
    t('workspaceGraph.event.referencesChanged', 'References changed'),
  NodeAggregateWithNodeWasCreated: () =>
    t('workspaceGraph.event.nodeCreated', 'Created'),
  NodeAggregateWasMoved: () => t('workspaceGraph.event.nodeMoved', 'Moved'),
  NodeAggregateWasRemoved: () =>
    t('workspaceGraph.event.nodeRemoved', 'Removed'),
  SubtreeWasTagged: () =>
    t('workspaceGraph.event.visibilityChanged', 'Visibility changed'),
  SubtreeWasUntagged: () =>
    t('workspaceGraph.event.visibilityChanged', 'Visibility changed'),
  NodeAggregateTypeWasChanged: () =>
    t('workspaceGraph.event.typeChanged', 'Type changed'),
  NodeAggregateNameWasChanged: () =>
    t('workspaceGraph.event.renamed', 'Renamed'),
  NodeSpecializationVariantWasCreated: () =>
    t('workspaceGraph.event.variantCreated', 'Variant created'),
  NodeGeneralizationVariantWasCreated: () =>
    t('workspaceGraph.event.variantCreated', 'Variant created'),
  NodePeerVariantWasCreated: () =>
    t('workspaceGraph.event.variantCreated', 'Variant created'),
}

function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type]?.() ?? type
}

const CLASSIFICATION_ICONS: Record<string, string> = {
  ROOT: 'fas fa-globe text-neutral-300',
  SHARED: 'fas fa-users text-purple-500',
  PRIVATE: 'fas fa-lock text-neutral-400',
  PERSONAL: 'fas fa-user text-neutral-400',
}

function workspaceLabel(workspace: Workspace): string {
  return workspace.classification === 'ROOT'
    ? t('workspace.live', 'Live')
    : workspace.title || workspace.name
}

/** What a pick selects: a workspace head card or one commit on a branch. */
interface Selection {
  workspace: string
  /** null = the head card itself. */
  sequenceNumber: number | null
}

function parsePick(id: string | null): Selection | null {
  if (id === null) return null
  if (id.startsWith('ws:')) {
    return { workspace: id.slice(3), sequenceNumber: null }
  }
  if (id.startsWith('event:')) {
    const separator = id.lastIndexOf(':')
    return {
      workspace: id.slice('event:'.length, separator),
      sequenceNumber: Number(id.slice(separator + 1)),
    }
  }
  return null
}

/** The branch-off curve from the fork point on the parent's line into the
 * own branch line, up to the head card. Roots draw just their trunk line
 * (when they have dots to carry); null = nothing to draw. */
function branchPath(branch: WorkspaceBranch): string | null {
  const line =
    branch.cardX > branch.startX ? ` L ${branch.cardX} ${branch.y}` : ''
  if (branch.branchFrom === null) {
    return line === '' ? null : `M ${branch.startX} ${branch.y}${line}`
  }
  const { x: fromX, y: fromY } = branch.branchFrom
  const bend = BRANCH_BEND * 0.6
  return (
    `M ${fromX} ${fromY} ` +
    `C ${fromX + bend} ${fromY}, ${branch.startX - bend} ${branch.y}, ${branch.startX} ${branch.y}` +
    line
  )
}

/**
 * The transformed graph surface (branch lines, commit dots, head cards).
 * Memoized so panning/zooming - a pure CSS transform on the wrapper - never
 * re-renders the branches.
 */
const GraphSurface = memo(function GraphSurface({
  graph,
  emphasized,
  selection,
  currentWorkspaceName,
  onCardMenu,
}: {
  graph: WorkspaceGraph
  /** Workspace names to emphasize; null = no selection, everything full. */
  emphasized: Set<string> | null
  selection: Selection | null
  currentWorkspaceName: string | null
  /** A head card was right-clicked. */
  onCardMenu: (workspaceName: string, anchor: { x: number; y: number }) => void
}) {
  const dimmed = (name: string): boolean =>
    emphasized !== null && !emphasized.has(name)
  return (
    <>
      <svg
        className="pointer-events-none absolute top-0 left-0 overflow-visible"
        width={graph.width}
        height={graph.height}
        aria-hidden
      >
        {graph.branches.map((branch) => {
          const path = branchPath(branch)
          if (path === null) return null
          return (
            <path
              key={branch.workspace.name}
              d={path}
              fill="none"
              stroke={branch.color}
              strokeWidth={2}
              strokeDasharray={branch.loading ? '4 4' : undefined}
              opacity={dimmed(branch.workspace.name) ? 0.2 : 1}
            />
          )
        })}
        {graph.branches.map((branch) =>
          branch.truncated ? (
            <text
              key={`${branch.workspace.name}:truncated`}
              x={branch.startX + DOT_SPACING * 0.5}
              y={branch.y + 4}
              textAnchor="middle"
              className="fill-neutral-500 text-[11px] font-bold tracking-widest"
              opacity={dimmed(branch.workspace.name) ? 0.2 : 1}
            >
              …
            </text>
          ) : null,
        )}
      </svg>
      {graph.branches.flatMap((branch) =>
        branch.dots.map((dot) => {
          const selected =
            selection?.workspace === branch.workspace.name &&
            selection.sequenceNumber === dot.event.sequenceNumber
          const summary = [
            eventTypeLabel(dot.event.type),
            dot.event.nodeLabel ?? dot.event.nodeAggregateId ?? '',
          ]
            .filter(Boolean)
            .join(': ')
          return (
            <div
              key={`${branch.workspace.name}:${dot.event.sequenceNumber}`}
              data-graph-id={`event:${branch.workspace.name}:${dot.event.sequenceNumber}`}
              className={cn(
                'absolute cursor-pointer rounded-full border-2 bg-neutral-950 transition-transform',
                selected && cn('scale-150', SELECTED_RING),
                dimmed(branch.workspace.name) && 'opacity-20',
              )}
              style={{
                left: dot.x - DOT_RADIUS,
                top: branch.y - DOT_RADIUS,
                width: DOT_RADIUS * 2,
                height: DOT_RADIUS * 2,
                borderColor: branch.color,
              }}
              title={`${summary}\n${dot.event.initiatingUserLabel ?? ''} ${new Date(dot.event.recordedAt).toLocaleString()}`.trim()}
            />
          )
        }),
      )}
      {graph.branches.map((branch) => {
        const workspace = branch.workspace
        const selected =
          selection?.workspace === workspace.name &&
          selection.sequenceNumber === null
        const isCurrent = currentWorkspaceName === workspace.name
        return (
          <div
            key={workspace.name}
            data-graph-id={`ws:${workspace.name}`}
            className={cn(
              'absolute cursor-pointer overflow-hidden rounded-md border-2 shadow-md',
              selected && SELECTED_RING,
              dimmed(workspace.name) && 'opacity-30',
            )}
            style={{
              left: branch.cardX,
              top: branch.cardY,
              width: WS_CARD_WIDTH,
              height: WS_CARD_HEIGHT,
              // The checked-out workspace's surface leans further into its
              // branch color; the "Editing" badge names it.
              ...cardSurface(branch.color, isCurrent ? 22 : 10),
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              onCardMenu(workspace.name, {
                x: event.clientX,
                y: event.clientY,
              })
            }}
          >
            <div className="flex flex-col gap-0.5 px-3 py-2">
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-white">
                <i
                  className={cn(
                    CLASSIFICATION_ICONS[workspace.classification] ??
                      'fas fa-layer-group text-neutral-400',
                    'fa-fw shrink-0 text-[0.7rem]',
                  )}
                  aria-hidden
                />
                <span className="truncate">{workspaceLabel(workspace)}</span>
                {isCurrent && (
                  <span className="ml-auto shrink-0 rounded-sm bg-blue-500/20 px-1 text-[8px] tracking-wide text-blue-400 uppercase">
                    {t('workspaceGraph.current', 'Editing')}
                  </span>
                )}
              </div>
              <div className="truncate font-mono text-[9px] text-neutral-500">
                {workspace.name}
              </div>
              <div className="flex items-center gap-2 text-[9px] text-neutral-400">
                {branch.branchFrom !== null && (
                  <span>
                    {t('workspaceGraph.changeCount', '{0} changes', [
                      `${branch.dots.length}${branch.truncated ? '+' : ''}`,
                    ])}
                  </span>
                )}
                {workspace.status === 'OUTDATED' && (
                  <span
                    className="text-amber-500"
                    title={t(
                      'workspaceGraph.outdated',
                      'The base workspace has newer changes',
                    )}
                  >
                    <i className="fas fa-triangle-exclamation" aria-hidden />{' '}
                    {t('workspaceGraph.outdatedShort', 'outdated')}
                  </span>
                )}
                {!workspace.permissions.write && (
                  <span title={t('workspace.readOnly', 'read-only')}>
                    <i className="fas fa-lock" aria-hidden />
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
})

/** The bottom-right detail card for a selected commit dot. Selecting a
 * workspace card only emphasizes its publish path - the card itself already
 * shows everything there is to say. */
function DetailCard({
  selection,
  graph,
  onClose,
}: {
  selection: Selection
  graph: WorkspaceGraph
  onClose: () => void
}) {
  const branch = graph.byName.get(selection.workspace)
  if (!branch || selection.sequenceNumber === null) return null
  const event: WorkspacePendingEvent | undefined = branch.dots.find(
    (dot) => dot.event.sequenceNumber === selection.sequenceNumber,
  )?.event
  if (!event) return null
  return (
    <div className="absolute right-2 bottom-2 z-10 w-72 rounded-md border border-neutral-700 bg-neutral-900/95 p-3 text-xs shadow-lg backdrop-blur-xs">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 font-medium text-white">
            <i
              className={cn(
                event.icon ? faClassName(event.icon) : 'fas fa-cube',
                'fa-fw shrink-0 text-[0.7rem] text-neutral-400',
              )}
              aria-hidden
            />
            <span className="truncate">
              {event.nodeLabel ??
                event.nodeAggregateId ??
                t('workspaceGraph.unknownNode', 'Unknown node')}
            </span>
          </div>
          <div className="mt-1 text-neutral-300">
            {eventTypeLabel(event.type)}
          </div>
          <div className="mt-1 text-neutral-500">
            {event.initiatingUserLabel && (
              <>
                <i className="fas fa-user fa-fw" aria-hidden />{' '}
                {event.initiatingUserLabel} ·{' '}
              </>
            )}
            {new Date(event.recordedAt).toLocaleString()}
          </div>
          {event.nodeType && (
            <div className="mt-1 truncate font-mono text-[9px] text-neutral-500">
              {event.nodeType}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0"
          onClick={onClose}
          title={t('workspaceGraph.closeDetails', 'Close details')}
        >
          <i className="fas fa-xmark" aria-hidden />
        </Button>
      </div>
    </div>
  )
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-10 flex flex-col gap-1 rounded-md bg-neutral-900/80 p-2 text-[10px] text-neutral-400 backdrop-blur-xs">
      <div className="flex items-center gap-1.5">
        <span className="size-2 rounded-full border-2 border-blue-500 bg-neutral-950" />
        {t('workspaceGraph.legend.change', 'Pending change')}
      </div>
      <div className="flex items-center gap-1.5">
        <i
          className="fas fa-users fa-fw text-[0.6rem] text-purple-500"
          aria-hidden
        />
        {t('workspaceGraph.legend.shared', 'Shared workspace')}
      </div>
      <div className="flex items-center gap-1.5">
        <i className="fas fa-user fa-fw text-[0.6rem]" aria-hidden />
        {t('workspaceGraph.legend.personal', 'Personal workspace')}
      </div>
      <div className="flex items-center gap-1.5">
        <i
          className="fas fa-triangle-exclamation fa-fw text-[0.6rem] text-amber-500"
          aria-hidden
        />
        {t('workspaceGraph.legend.outdated', 'Base has newer changes')}
      </div>
    </div>
  )
}

/** An open card context menu: which workspace, anchored where. */
interface CardMenu {
  workspaceName: string
  anchor: { x: number; y: number }
}

export function WorkspaceGraphPanel() {
  const canvasRef = useRef<GraphCanvasHandle>(null)
  const {
    workspaceName: currentWorkspaceName,
    personalWorkspaceName,
    navigateToNodeInWorkspace,
    checkoutWorkspace,
  } = useStudio()
  // The panel mounts hidden behind the Visual Editor tab: fetch only once it
  // has been shown, poll only while it stays visible.
  const [shown, setShown] = useState(false)
  const [active, setActive] = useState(false)
  const refetchInterval = active ? REFRESH_INTERVAL : undefined

  const {
    data,
    isLoading: workspacesLoading,
    isError,
  } = useWorkspaces(shown, refetchInterval)
  const workspaces = useMemo(() => data?.workspaces ?? [], [data?.workspaces])

  // Pending histories for every workspace - branches for their commit dots
  // and fork points, roots (live) for the published stretch children branch
  // off of.
  const workspaceNames = useMemo(
    () => workspaces.map((workspace) => workspace.name).sort(),
    [workspaces],
  )
  const { byWorkspace: pending, isLoading: eventsLoading } =
    useWorkspacesPendingEvents(workspaceNames, shown, refetchInterval)

  const graph = useMemo(
    () => buildWorkspaceGraph(workspaces, pending),
    [workspaces, pending],
  )

  const [selection, setSelection] = useState<Selection | null>(null)
  const emphasized = useMemo(
    () =>
      selection !== null && graph.byName.has(selection.workspace)
        ? baseChainOf(selection.workspace, graph)
        : null,
    [selection, graph],
  )

  // The card context menu and what it leads to: a review dialog opened on the
  // right-clicked workspace, or a rebase (with the shared conflict handling).
  const [menu, setMenu] = useState<CardMenu | null>(null)
  const [reviewSource, setReviewSource] = useState<string | null>(null)
  const { rebase, changeBase, discardAll, conflicts, clearConflicts, busy } =
    useWorkspaceSync()
  const onCardMenu = useCallback(
    (workspaceName: string, anchor: { x: number; y: number }) =>
      setMenu({ workspaceName, anchor }),
    [],
  )

  const menuWorkspace = menu
    ? (workspaces.find((workspace) => workspace.name === menu.workspaceName) ??
      null)
    : null
  // The review dialog needs the active workspace (its default source); it
  // exists whenever the app is initialized enough to right-click a card.
  const activeWorkspace =
    workspaces.find((workspace) => workspace.name === currentWorkspaceName) ??
    null

  const isLoading =
    workspacesLoading ||
    (workspaces.length > 0 && eventsLoading && pending.size === 0)

  return (
    <GraphCanvas
      ref={canvasRef}
      contentWidth={graph.width}
      contentHeight={graph.height}
      maxScale={2.5}
      onVisibilityChange={(visible) => {
        if (visible) setShown(true)
        setActive(visible)
      }}
      onPick={(id) => setSelection(parsePick(id))}
      overlay={
        <>
          <Legend />
          {selection !== null && graph.byName.has(selection.workspace) && (
            <DetailCard
              selection={selection}
              graph={graph}
              onClose={() => setSelection(null)}
            />
          )}
          {menuWorkspace && menu && (
            <DropdownMenu open onOpenChange={(open) => !open && setMenu(null)}>
              {/* Invisible anchor at the right-click position - the same
                  pattern the node context menu uses. */}
              <DropdownMenuTrigger
                aria-hidden
                tabIndex={-1}
                style={{
                  position: 'fixed',
                  left: menu.anchor.x,
                  top: menu.anchor.y,
                  width: 0,
                  height: 0,
                  opacity: 0,
                  pointerEvents: 'none',
                }}
              />
              <DropdownMenuContent align="start">
                {(() => {
                  const isCurrent = menuWorkspace.name === currentWorkspaceName
                  // Checkout: back to the own personal workspace, or into a
                  // shared one (collaborative editing - needs write there).
                  const offerCheckout =
                    !isCurrent &&
                    (menuWorkspace.name === personalWorkspaceName ||
                      menuWorkspace.classification === 'SHARED')
                  const checkoutDisabled =
                    menuWorkspace.classification === 'SHARED' &&
                    !menuWorkspace.permissions.write
                  // Rebase THE CHECKED-OUT workspace onto the clicked one.
                  // Valid targets are what the workspace switcher offers as
                  // bases: live and shared workspaces. Onto the current base
                  // it is a plain rebase (synchronize); onto anything else it
                  // retargets the base (requires a clean workspace).
                  const offerRebase =
                    !isCurrent &&
                    activeWorkspace !== null &&
                    (menuWorkspace.classification === 'ROOT' ||
                      menuWorkspace.classification === 'SHARED')
                  const offerReview = menuWorkspace.baseWorkspace !== null
                  return (
                    <>
                      {offerCheckout && (
                        <DropdownMenuItem
                          disabled={checkoutDisabled}
                          title={
                            checkoutDisabled
                              ? t('workspace.readOnly', 'read-only')
                              : t(
                                  'workspaceGraph.menu.checkoutHint',
                                  'Switch editing into this workspace',
                                )
                          }
                          onClick={() => {
                            setMenu(null)
                            checkoutWorkspace(menuWorkspace.name)
                          }}
                        >
                          <i
                            className="fas fa-fw fa-right-to-bracket"
                            aria-hidden
                          />
                          {t('workspaceGraph.menu.checkout', 'Checkout')}
                        </DropdownMenuItem>
                      )}
                      {offerRebase && activeWorkspace && (
                        <DropdownMenuItem
                          disabled={busy}
                          title={
                            menuWorkspace.name === activeWorkspace.baseWorkspace
                              ? t(
                                  'workspaceGraph.menu.rebaseSyncHint',
                                  'Rebase “{0}” onto its base again: newest changes from here flow in underneath your pending ones',
                                  [workspaceLabel(activeWorkspace)],
                                )
                              : t(
                                  'workspaceGraph.menu.rebaseHint',
                                  'Rebase “{0}” onto this workspace - it becomes the new base to publish to',
                                  [workspaceLabel(activeWorkspace)],
                                )
                          }
                          onClick={() => {
                            setMenu(null)
                            if (
                              menuWorkspace.name ===
                              activeWorkspace.baseWorkspace
                            ) {
                              rebase.mutate({
                                workspaceName: activeWorkspace.name,
                              })
                            } else {
                              changeBase.mutate({
                                workspaceName: activeWorkspace.name,
                                baseWorkspace: menuWorkspace.name,
                              })
                            }
                          }}
                        >
                          <i className="fas fa-fw fa-rotate" aria-hidden />
                          {t('workspaceGraph.menu.rebase', 'Rebase')}
                        </DropdownMenuItem>
                      )}
                      {offerReview && (offerCheckout || offerRebase) && (
                        <DropdownMenuSeparator />
                      )}
                      {offerReview && (
                        <DropdownMenuItem
                          onClick={() => {
                            setMenu(null)
                            setReviewSource(menuWorkspace.name)
                          }}
                        >
                          <i className="fas fa-fw fa-list-check" aria-hidden />
                          {t('workspaceGraph.menu.review', 'Review changes…')}
                        </DropdownMenuItem>
                      )}
                    </>
                  )
                })()}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {activeWorkspace && (
            <ReviewChangesDialog
              workspaces={workspaces}
              activeWorkspace={activeWorkspace}
              initialSourceName={reviewSource ?? undefined}
              open={reviewSource !== null}
              onOpenChange={(open) => !open && setReviewSource(null)}
              onNavigate={(address, workspaceName) => {
                setReviewSource(null)
                navigateToNodeInWorkspace(address, workspaceName)
              }}
            />
          )}
          <ConflictResolutionDialog
            open={conflicts !== null}
            conflicts={conflicts?.conflicts ?? []}
            partial={conflicts?.code === 'partial_publish_conflicts'}
            busy={busy}
            onCancel={clearConflicts}
            onForce={() =>
              conflicts &&
              rebase.mutate({
                workspaceName: conflicts.workspaceName,
                strategy: 'force',
              })
            }
            onDiscardAll={() =>
              conflicts && discardAll.mutate(conflicts.workspaceName)
            }
            onNavigate={(address) => {
              if (!conflicts) return
              clearConflicts()
              // The conflicting document lives in the synced workspace -
              // follow it there (switching the editing context if needed).
              navigateToNodeInWorkspace(address, conflicts.workspaceName)
            }}
          />
          {isLoading && (
            <LoadingState
              className="absolute inset-0"
              label={t('workspaceGraph.loading', 'Loading workspaces…')}
            />
          )}
          {isError && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-400">
              {t(
                'workspaceGraph.loadFailed',
                'The workspaces could not be loaded.',
              )}
            </div>
          )}
        </>
      }
    >
      {!isLoading && !isError && graph.branches.length > 0 && (
        <GraphSurface
          graph={graph}
          emphasized={emphasized}
          selection={selection}
          currentWorkspaceName={currentWorkspaceName}
          onCardMenu={onCardMenu}
        />
      )}
    </GraphCanvas>
  )
}
