import { partialMatchKey, type Query } from '@tanstack/react-query'
import {
  invalidateWorkspaceHistory,
  type useWorkspaceChanges,
} from '@/api/neos/endpoints/workspaces'
import { neosKeys } from '@/api/neos/keys'
import {
  type NodeAddress,
  nodeAddressKey,
  sameDimensionSpacePoint,
  type Workspace,
} from '@/api/neos/schema'
import { studioKeys } from '@/api/studio/keys'
import { queryClient } from '@/app/queryClient'

/**
 * The cache refreshes after writes, from broad to narrow. Big projects have
 * many workspaces, each with thousands of node reads and pending changes, so
 * every helper names the narrowest set a write can affect - and the
 * refreshes of frequent writes (content edits, a colleague's saves) are cheap
 * or coalesced:
 *
 * - invalidateWorkspaceQueries: every workspace read - for writes that
 *   reshape the workspace graph (create, delete, roles, base changes).
 * - afterWorkspaceRewrite / afterPublish: one workspace's content stream was
 *   rewritten (and, publishing, its base's).
 * - afterStructuralEdit: a node was created, moved, copied, deleted,
 *   (un)hidden or retyped in one workspace.
 * - invalidateAfterContentEdit: a property or reference was saved - skips
 *   the full pending-changes refetch when the edited nodes are already
 *   listed as changed.
 * - scheduleInvalidateAfterContentEdit: the same, coalesced per workspace -
 *   for the remote edits that arrive with every tick of the change feed.
 *
 * None of them is meant to be awaited by a write: invalidating marks the
 * queries stale synchronously (any read after it fetches fresh data), the
 * returned promise only tells when the active ones have refetched.
 */

/**
 * Refresh everything workspace-related: Neos.Api's workspace reads (the list,
 * changes, roles, events - and what the review, pending history and trash are
 * made of) - after a write that may affect any of them: publish, discard,
 * rebase, a base workspace change, a workspace created or deleted. The
 * tasks too: the server marks a task done when its workspace is published
 * and drops it with its workspace.
 */
export function invalidateWorkspaceQueries(): Promise<unknown> {
  // Covers whatever a coalesced content-edit refresh would still do.
  cancelScheduledContentEditInvalidations()
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: neosKeys.workspaces.all }),
    queryClient.invalidateQueries({ queryKey: studioKeys.tasks.all }),
  ])
}

/**
 * How old a pending-changes read may be to still be trusted for skipping its
 * refetch (see invalidateAfterContentEdit). It also carries the workspace's
 * status ("outdated": the base moved on), which edits used to refresh as a
 * side effect - an editor working on already-changed nodes for a while still
 * sees that status at most this late.
 */
const PENDING_CHANGES_TRUSTED_FOR_MS = 30_000

/**
 * Refresh what a content edit in one workspace changes: its changes (the
 * pending changes behind the dirty markers, and the review, trash, diffs and
 * conflicts made of them) and its pending history - not the workspace list,
 * roles, node reads or other workspaces. For property and reference saves,
 * local or remote, which come often (a typing colleague saves every few
 * seconds) - see scheduleInvalidateAfterContentEdit for the remote ones.
 *
 * `editedNodes` - the edited nodes, in the dimension space point the edit
 * was made in - lets it skip the costliest part: the pending changes are
 * read in full (every page - thousands of entries in a big workspace), and
 * an edit of a node that already has a property change listed in that
 * origin leaves the list as it is (one entry per node variant with flags, no
 * values - the values are in the review's diffs, which are refetched). A
 * cached list is kept when it lists every edited node that way and is
 * recent (PENDING_CHANGES_TRUSTED_FOR_MS); anything else - an unknown node,
 * a change of the aggregate as a whole (no origin: a property change adds a
 * variant's own entry), a created or moved node not yet "changed", an edit
 * without editedNodes - refetches it.
 *
 * `cancelRefetch: false` keeps a refetch already under way instead of
 * restarting it - for a second report of the same edit, when the first one
 * already started the refetch after the write.
 */
export function invalidateAfterContentEdit(
  contentRepositoryId: string,
  workspaceName: string,
  editedNodes?: readonly NodeAddress[],
  options?: { cancelRefetch?: boolean },
): Promise<unknown> {
  if (editedNodes === undefined) {
    // A full refresh - covers whatever a coalesced one would still do.
    cancelScheduledContentEditInvalidation(contentRepositoryId, workspaceName)
  }
  const listKey = neosKeys.workspaces.list(contentRepositoryId)
  // The first edit makes the workspace publishable: then (and only then) the
  // list's hasPublishableChanges flag is stale too.
  const listed = queryClient
    .getQueryData<Workspace[]>(listKey)
    ?.find((workspace) => workspace.name === workspaceName)
  const pendingChangesKey = neosKeys.workspaces.allPendingChanges(
    contentRepositoryId,
    workspaceName,
  )
  return Promise.all([
    queryClient.invalidateQueries(
      {
        queryKey: neosKeys.workspaces.changes(
          contentRepositoryId,
          workspaceName,
        ),
        predicate: (query) =>
          !(
            editedNodes !== undefined &&
            editedNodes.length > 0 &&
            partialMatchKey(query.queryKey, pendingChangesKey) &&
            listsAsChanged(query, editedNodes)
          ),
      },
      options,
    ),
    invalidateWorkspaceHistory(contentRepositoryId, workspaceName),
    listed && !listed.hasPublishableChanges
      ? queryClient.invalidateQueries({ queryKey: listKey }, options)
      : null,
  ])
}

type PendingChangesData = NonNullable<
  ReturnType<typeof useWorkspaceChanges>['data']
>

/**
 * Whether a pending-changes read (see invalidateAfterContentEdit) is recent
 * and lists a property change of every edited node in the dimension space
 * point it was edited in - another such edit leaves it unchanged. An edit
 * writes to the variant originating in its dimension space point (a
 * shine-through node is varied there first, see persistProperty), hence the
 * exact origin match.
 */
function listsAsChanged(
  query: Query,
  editedNodes: readonly NodeAddress[],
): boolean {
  const { status, data, dataUpdatedAt } = query.state
  if (
    status !== 'success' ||
    Date.now() - dataUpdatedAt > PENDING_CHANGES_TRUSTED_FOR_MS
  ) {
    return false
  }
  const { changes } = data as PendingChangesData
  return editedNodes.every((node) =>
    changes.some(
      (change) =>
        change.nodeAggregateId === node.nodeAggregateId &&
        change.changed &&
        change.originDimensionSpacePoint !== null &&
        sameDimensionSpacePoint(
          change.originDimensionSpacePoint,
          node.dimensionSpacePoint,
        ),
    ),
  )
}

/**
 * How long a workspace's remote content edits are collected before its
 * changes and history refresh once (trailing: each edit restarts the wait),
 * and how long at most - a colleague typing without pause still shows up in
 * the dirty markers and the history every few seconds.
 */
const CONTENT_EDIT_DEBOUNCE_MS = 1_200
const CONTENT_EDIT_MAX_WAIT_MS = 5_000

interface ScheduledContentEditInvalidation {
  /** The edited nodes by address key; null: unknown, refresh fully. */
  editedNodes: Map<string, NodeAddress> | null
  /** When the first edit of this batch was scheduled - for the max wait. */
  firstScheduledAt: number
  timer: ReturnType<typeof setTimeout>
}

/** By workspace (content repository and name, see scheduledKey). */
const scheduledContentEditInvalidations = new Map<
  string,
  ScheduledContentEditInvalidation
>()

function scheduledKey(contentRepositoryId: string, workspaceName: string) {
  return JSON.stringify([contentRepositoryId, workspaceName])
}

/**
 * invalidateAfterContentEdit, coalesced per workspace: the edits reported
 * within CONTENT_EDIT_DEBOUNCE_MS of each other (at most
 * CONTENT_EDIT_MAX_WAIT_MS) refresh once, for all their nodes together -
 * without editedNodes, or with any of them reported without, fully. For
 * edits that arrive in bursts and need no instant feedback: a colleague's
 * saves come with every tick of the change feed while they type. Node reads
 * are not covered - those the caller refreshes right away, the preview and
 * the trees show the edit without waiting for the dirty markers.
 */
export function scheduleInvalidateAfterContentEdit(
  contentRepositoryId: string,
  workspaceName: string,
  editedNodes?: readonly NodeAddress[],
): void {
  const key = scheduledKey(contentRepositoryId, workspaceName)
  const now = Date.now()
  const scheduled = scheduledContentEditInvalidations.get(key)
  if (scheduled) clearTimeout(scheduled.timer)
  let nodes: Map<string, NodeAddress> | null = null
  if (editedNodes !== undefined && scheduled?.editedNodes !== null) {
    nodes = new Map(scheduled?.editedNodes)
    for (const node of editedNodes) nodes.set(nodeAddressKey(node), node)
  }
  const firstScheduledAt = scheduled?.firstScheduledAt ?? now
  const delay = Math.max(
    0,
    Math.min(
      CONTENT_EDIT_DEBOUNCE_MS,
      firstScheduledAt + CONTENT_EDIT_MAX_WAIT_MS - now,
    ),
  )
  const timer = setTimeout(() => {
    scheduledContentEditInvalidations.delete(key)
    void invalidateAfterContentEdit(
      contentRepositoryId,
      workspaceName,
      nodes === null ? undefined : [...nodes.values()],
    )
  }, delay)
  scheduledContentEditInvalidations.set(key, {
    editedNodes: nodes,
    firstScheduledAt,
    timer,
  })
}

/** Drop the workspace's coalesced refresh - a full one happens right now. */
function cancelScheduledContentEditInvalidation(
  contentRepositoryId: string,
  workspaceName: string,
): void {
  const key = scheduledKey(contentRepositoryId, workspaceName)
  const scheduled = scheduledContentEditInvalidations.get(key)
  if (!scheduled) return
  clearTimeout(scheduled.timer)
  scheduledContentEditInvalidations.delete(key)
}

function cancelScheduledContentEditInvalidations(): void {
  for (const scheduled of scheduledContentEditInvalidations.values()) {
    clearTimeout(scheduled.timer)
  }
  scheduledContentEditInvalidations.clear()
}

/**
 * Refresh after a structural edit in one workspace - a node created, copied,
 * moved, deleted, hidden/unhidden or retyped: every node read in that
 * workspace and its changes and history (as a content edit, fully - the
 * pending changes gain or change entries). Not the other workspaces: their
 * content streams are untouched until they are rebased, and the list only
 * when the workspace just became publishable.
 *
 * The node reads go by the workspace, not by the affected nodes: a
 * structural edit reaches beyond the node and its parents - children lists
 * of the old and the new parent, ancestors of the whole moved subtree, tags
 * inherited by every descendant, descendant searches keyed by any ancestor
 * (a document's filter, the site's search), references pointing at a
 * deleted node, the other dimension space points a move or delete covers.
 * Invalidating refetches only the active reads, the rest is just marked
 * stale - cheap, unlike guessing the affected set wrong.
 */
export function afterStructuralEdit(
  contentRepositoryId: string,
  workspaceName: string,
): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: neosKeys.nodes.workspace(contentRepositoryId, workspaceName),
    }),
    invalidateAfterContentEdit(contentRepositoryId, workspaceName),
  ])
}

/**
 * Refresh after a write that rewrote a workspace's content stream - publish,
 * discard, rebase, a base workspace change, a restore from the trash: every
 * workspace read (status flags, changes, events of it and of its base) and
 * every node read in that workspace, which may now show other content. The
 * caller tells the shell (workspaceContentChanged) when it is the workspace
 * being edited - trees and the preview re-read then.
 */
export function afterWorkspaceRewrite(
  contentRepositoryId: string,
  workspaceName: string,
): Promise<unknown> {
  return Promise.all([
    invalidateWorkspaceQueries(),
    queryClient.invalidateQueries({
      queryKey: neosKeys.nodes.workspace(contentRepositoryId, workspaceName),
    }),
  ])
}

/**
 * Refresh after a publish: as afterWorkspaceRewrite (publishing rebases the
 * workspace onto its new base), plus the node reads of the base workspace,
 * whose content the publish changed. The base is looked up in the cached
 * workspace list (still holding its data while it refetches); not knowing
 * it, every node read of the content repository is refreshed.
 */
export function afterPublish(
  contentRepositoryId: string,
  workspaceName: string,
): Promise<unknown> {
  const baseWorkspaceName = queryClient
    .getQueryData<Workspace[]>(neosKeys.workspaces.list(contentRepositoryId))
    ?.find((workspace) => workspace.name === workspaceName)?.baseWorkspaceName
  return Promise.all([
    afterWorkspaceRewrite(contentRepositoryId, workspaceName),
    queryClient.invalidateQueries({
      queryKey: baseWorkspaceName
        ? neosKeys.nodes.workspace(contentRepositoryId, baseWorkspaceName)
        : neosKeys.nodes.contentRepository(contentRepositoryId),
    }),
  ])
}
