import type {
  Workspace,
  WorkspacePendingEvent,
  WorkspacePendingEvents,
} from '@/api/workspaces'

/**
 * Layout for the Workspaces graph: workspaces as git-style branches. Live (a
 * root workspace) is the trunk on the left; every other workspace branches
 * off the head of its base workspace with its pending changes as commit dots
 * along the branch line, ending in a head card. Workspaces based on another
 * workspace branch off that workspace's head in turn, so the picture reads
 * "this is what everyone has built on top of the published state".
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
  for (const siblings of children.values()) siblings.sort(branchSort)

  const branches: WorkspaceBranch[] = []
  const branchByName = new Map<string, WorkspaceBranch>()
  let nextLane = 0
  let colorCursor = 0

  const place = (
    workspace: Workspace,
    parent: WorkspaceBranch | null,
  ): void => {
    const lane = nextLane++
    const y = lane * LANE_HEIGHT + LANE_HEIGHT / 2
    const history = pending.get(workspace.name)
    const isRoot = parent === null
    // Roots show no pending dots: their stream is the published history
    // itself, not changes waiting to go anywhere.
    const dots: CommitDot[] = []
    let branch: WorkspaceBranch
    if (isRoot) {
      branch = {
        workspace,
        lane,
        color: ROOT_COLOR,
        branchFrom: null,
        startX: 0,
        y,
        cardX: 0,
        cardY: y - WS_CARD_HEIGHT / 2,
        dots,
        truncated: false,
        loading: false,
      }
    } else {
      const events = history?.events ?? []
      const truncated = history?.truncated ?? false
      const startX = parent.cardX + WS_CARD_WIDTH + BRANCH_BEND
      // The truncation ellipsis occupies the first dot slot.
      const slotOffset = truncated ? 1 : 0
      for (let index = 0; index < events.length; index++) {
        dots.push({
          x: startX + (slotOffset + index + 0.5) * DOT_SPACING,
          event: events[index],
        })
      }
      const lineLength = Math.max(
        MIN_LINE_LENGTH,
        (slotOffset + events.length) * DOT_SPACING + LINE_END_GAP,
      )
      branch = {
        workspace,
        lane,
        color: BRANCH_COLORS[colorCursor++ % BRANCH_COLORS.length],
        branchFrom: { x: parent.cardX + WS_CARD_WIDTH, y: parent.y },
        startX,
        y,
        cardX: startX + lineLength,
        cardY: y - WS_CARD_HEIGHT / 2,
        dots,
        truncated,
        loading: history === undefined,
      }
    }
    branches.push(branch)
    branchByName.set(workspace.name, branch)
    for (const child of children.get(workspace.name) ?? []) {
      place(child, branch)
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
