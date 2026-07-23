import type {
  Workspace,
  WorkspacePendingEvent,
  WorkspacePendingEvents,
} from '@/api/workspaces'

/**
 * Layout for the Workspaces graph: workspaces as git-style branches. Live (a
 * root workspace) is the trunk on the left; every other workspace branches
 * off its base workspace's line with its pending changes as commit dots along
 * the branch line, ending in a head card. Workspaces based on another
 * workspace branch off that workspace's line in turn, so the picture reads
 * "this is what everyone has built on top of the published state".
 *
 * The branch point is the FORK point, not the base's head: a workspace's
 * stream records where (stream + version) it forked off its base, so base
 * events it already contains lie left of the branch point and events
 * published to the base afterwards lie right of it - an OUTDATED workspace
 * visibly hangs behind the changes it has not pulled in yet. Roots (live)
 * only surface their published history from the earliest child fork onwards;
 * everything older collapses into the leading ellipsis.
 *
 * Pure geometry, like the node type layout: each workspace occupies one
 * horizontal lane, x grows with branch depth and commit count, and the
 * rendering shares these pixel constants so lines anchor exactly.
 */

export const WS_CARD_WIDTH = 240
export const WS_CARD_HEIGHT = 78
export const LANE_HEIGHT = 100
/** Distance between two commit dots on a branch line. */
export const DOT_SPACING = 36
/** Horizontal room the branch-off curve gets before the first commit. */
export const BRANCH_BEND = 90
/** Gap between the last commit dot and the head card. */
export const LINE_END_GAP = 28
/** Minimum branch line length, so an empty branch is still visibly a branch. */
const MIN_LINE_LENGTH = 60
/** Most dots a root (live) line shows - published history is long, only the
 * stretch since the earliest child fork tells a story. */
const ROOT_MAX_DOTS = 25

/**
 * Branch line colors, cycled per branch in layout order. Live/root trunks
 * stay neutral; the palette starts with the Neos brand hues, then falls back
 * to default Tailwind hues (which the Studio theme extends, not replaces).
 */
const ROOT_COLOR = 'var(--color-neutral-400)'
const BRANCH_COLORS = [
  'var(--color-blue-500)',
  'var(--color-orange-500)',
  'var(--color-green-500)',
  'var(--color-purple-400)',
  'var(--color-pink-500)',
  'var(--color-cyan-500)',
  'var(--color-red-500)',
  'var(--color-teal-500)',
]

export interface CommitDot {
  /** Dot center on the branch line. */
  x: number
  event: WorkspacePendingEvent
}

export interface WorkspaceBranch {
  workspace: Workspace
  /** Lane index, top to bottom. */
  lane: number
  color: string
  /** Branch-off point on the parent's head card; null for roots. */
  branchFrom: { x: number; y: number } | null
  /** Where the branch's own horizontal line begins. */
  startX: number
  /** Lane center - the y of the branch line and the dots. */
  y: number
  /** Head card position (top-left). */
  cardX: number
  cardY: number
  dots: CommitDot[]
  /** Older events exist beyond the listed dots. */
  truncated: boolean
  /** The pending history has not arrived (yet) - drawn as an indeterminate line. */
  loading: boolean
}

export interface WorkspaceGraph {
  branches: WorkspaceBranch[]
  byName: Map<string, WorkspaceBranch>
  width: number
  height: number
}

/** Shared drafts before private ones before personal workspaces, then title. */
const CLASSIFICATION_ORDER: Record<string, number> = {
  ROOT: 0,
  SHARED: 1,
  PRIVATE: 2,
  PERSONAL: 3,
}

function branchSort(a: Workspace, b: Workspace): number {
  const rank =
    (CLASSIFICATION_ORDER[a.classification] ?? 4) -
    (CLASSIFICATION_ORDER[b.classification] ?? 4)
  if (rank !== 0) return rank
  return (a.title || a.name).localeCompare(b.title || b.name)
}

export function buildWorkspaceGraph(
  workspaces: Workspace[],
  pending: Map<string, WorkspacePendingEvents>,
): WorkspaceGraph {
  const byName = new Map(
    workspaces.map((workspace) => [workspace.name, workspace]),
  )
  const children = new Map<string, Workspace[]>()
  const roots: Workspace[] = []
  for (const workspace of workspaces) {
    // A base the account cannot read is a base we cannot draw - such a
    // workspace becomes its own root rather than vanishing.
    if (
      workspace.baseWorkspace !== null &&
      byName.has(workspace.baseWorkspace)
    ) {
      const siblings = children.get(workspace.baseWorkspace) ?? []
      siblings.push(workspace)
      children.set(workspace.baseWorkspace, siblings)
    } else {
      roots.push(workspace)
    }
  }
  roots.sort(branchSort)
  // Children are ordered per parent at placement time, by branch point.

  const branches: WorkspaceBranch[] = []
  const branchByName = new Map<string, WorkspaceBranch>()
  let nextLane = 0
  let colorCursor = 0

  const place = (
    workspace: Workspace,
    branchFrom: { x: number; y: number } | null,
  ): void => {
    const lane = nextLane++
    const y = lane * LANE_HEIGHT + LANE_HEIGHT / 2
    const history = pending.get(workspace.name)
    const isRoot = branchFrom === null
    const kids = children.get(workspace.name) ?? []

    // A child's fork version on THIS workspace's current stream: null while
    // its history has not arrived, -1 when it forked off an EARLIER stream
    // (this workspace was rebased/republished since - none of the events
    // shown here are in the child).
    const forkVersionOf = (child: Workspace): number | null => {
      const childHistory = pending.get(child.name)
      if (!childHistory?.forkedFrom || !history) return null
      return childHistory.forkedFrom.contentStreamId === history.contentStreamId
        ? childHistory.forkedFrom.version
        : -1
    }

    // Which events get dots. A branch shows its whole pending history; a
    // root's stream is the published history itself, so only the stretch
    // after the earliest child fork is telling ("published, but not in that
    // branch yet") - everything older collapses into the leading ellipsis.
    let events = history?.events ?? []
    let hiddenOlder = history?.truncated ?? false
    if (isRoot) {
      const forkVersions = kids
        .map(forkVersionOf)
        .filter(
          (version): version is number => version !== null && version >= 0,
        )
      if (forkVersions.length === 0) {
        events = []
        hiddenOlder = false
      } else {
        const cut = Math.min(...forkVersions)
        events = events
          .filter((event) => event.version > cut)
          .slice(-ROOT_MAX_DOTS)
        // There is always earlier published history behind the cut.
        hiddenOlder = true
      }
    }

    const startX = branchFrom === null ? 0 : branchFrom.x + BRANCH_BEND
    // The ellipsis for hidden older events occupies the first dot slot.
    const slotOffset = hiddenOlder ? 1 : 0
    const dots: CommitDot[] = events.map((event, index) => ({
      x: startX + (slotOffset + index + 0.5) * DOT_SPACING,
      event,
    }))
    const lineLength =
      isRoot && dots.length === 0
        ? 0
        : Math.max(
            MIN_LINE_LENGTH,
            (slotOffset + events.length) * DOT_SPACING + LINE_END_GAP,
          )
    const cardX = startX + lineLength

    const branch: WorkspaceBranch = {
      workspace,
      lane,
      color: isRoot
        ? ROOT_COLOR
        : BRANCH_COLORS[colorCursor++ % BRANCH_COLORS.length],
      branchFrom,
      startX,
      y,
      cardX,
      cardY: y - WS_CARD_HEIGHT / 2,
      dots,
      truncated: hiddenOlder,
      loading: !isRoot && history === undefined,
    }
    branches.push(branch)
    branchByName.set(workspace.name, branch)

    // Where each child branches off this line: right after the last event it
    // still contains, so everything further right is what it is missing. A
    // child whose fork we cannot place (history loading, or all shown events
    // are older than its fork) branches at the head.
    const headX = cardX + WS_CARD_WIDTH
    const branchXFor = (child: Workspace): number => {
      const forkVersion = forkVersionOf(child)
      if (forkVersion === null) return headX
      if (forkVersion === -1) return dots.length > 0 ? startX : headX
      const nextIndex = dots.findIndex((dot) => dot.event.version > forkVersion)
      if (nextIndex === -1) return headX
      const left =
        nextIndex === 0
          ? startX + slotOffset * DOT_SPACING
          : dots[nextIndex - 1].x
      return (left + dots[nextIndex].x) / 2
    }

    // Later branch points get the nearer lanes: the lower a child sits, the
    // further left it forks, so its curve descends where the subtrees above
    // it have nothing drawn yet - no line crossings.
    const ordered = kids
      .map((child) => ({ child, branchX: branchXFor(child) }))
      .sort((a, b) => b.branchX - a.branchX || branchSort(a.child, b.child))
    for (const { child, branchX } of ordered) {
      place(child, { x: branchX, y })
    }
  }

  for (const root of roots) place(root, null)

  const width = branches.reduce(
    (max, branch) => Math.max(max, branch.cardX + WS_CARD_WIDTH),
    0,
  )
  return {
    branches,
    byName: branchByName,
    width,
    height: nextLane * LANE_HEIGHT,
  }
}

/** The workspace names from `name` up its base chain to the root - what a
 * selection emphasizes (the path a publish would travel). */
export function baseChainOf(name: string, graph: WorkspaceGraph): Set<string> {
  const chain = new Set<string>()
  let current: string | null = name
  while (current !== null && !chain.has(current)) {
    chain.add(current)
    current = graph.byName.get(current)?.workspace.baseWorkspace ?? null
  }
  return chain
}
