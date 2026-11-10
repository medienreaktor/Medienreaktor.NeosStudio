import { neosKeys } from '@/api/neos/keys'
import type { NodeAddress } from '@/api/neos/schema'
import type { WorkspaceRef } from '@/app/events'
import { queryClient } from '@/app/queryClient'
import {
  afterPublish,
  afterStructuralEdit,
  afterWorkspaceRewrite,
  invalidateAfterContentEdit,
  invalidateWorkspaceQueries,
} from '@/features/workspaces/invalidate'

/**
 * The shell's cache refreshes, for a plugin's own writes (apiFetch) to
 * Neos content: each marks stale what the write can have changed of the
 * shell's cached reads, so the shell's views show it. The query keys behind
 * them are internal and change as the shell's reads do - these are the
 * contract. They only refresh data: what the trees and the preview show is
 * refreshed by the Studio actions (nodeEdited, nodesEdited,
 * workspaceContentChanged), which a plugin calls as well for the workspace
 * being edited.
 *
 * None needs awaiting: the reads are stale as soon as it returns, so
 * whatever reads next fetches fresh data; the promise only tells when the
 * active reads have refetched.
 */
export interface StudioInvalidation {
  /**
   * Properties or references of these nodes were written: their reads, and
   * their workspace's pending changes (dirty markers, the review) and
   * history. Pass the addresses as written - in the dimension space point
   * the edit was made in.
   */
  afterContentEdit: (nodes: readonly NodeAddress[]) => Promise<void>
  /**
   * Nodes were created, copied, moved, deleted, hidden/unhidden, retyped or
   * varied in this workspace: its node reads (all of them - a structural
   * edit reaches beyond the nodes acted on), pending changes and history.
   */
  afterStructuralEdit: (workspace: WorkspaceRef) => Promise<void>
  /**
   * The workspace was published: the workspace reads, and the node reads of
   * it and of its base (whose content the publish changed).
   */
  afterPublish: (workspace: WorkspaceRef) => Promise<void>
  /**
   * The workspace's content was rewritten - discarded, rebased, moved onto
   * another base: the workspace reads and its node reads.
   */
  afterWorkspaceRewrite: (workspace: WorkspaceRef) => Promise<void>
  /**
   * The workspaces themselves changed - one created, deleted, renamed, its
   * roles or base changed: every workspace read (lists, status, changes).
   */
  afterWorkspacesChanged: () => Promise<void>
}

const settled = (promise: Promise<unknown>): Promise<void> =>
  promise.then(() => undefined)

export const invalidate: StudioInvalidation = {
  afterContentEdit: (nodes) => {
    // By workspace: the pending changes are one read per workspace, and
    // naming the nodes lets an already changed one skip its refetch.
    const byWorkspace = new Map<string, NodeAddress[]>()
    for (const node of nodes) {
      const key = JSON.stringify([node.contentRepositoryId, node.workspaceName])
      byWorkspace.set(key, [...(byWorkspace.get(key) ?? []), node])
    }
    return settled(
      Promise.all([
        ...nodes.map((node) =>
          queryClient.invalidateQueries({
            queryKey: neosKeys.nodes.node(node),
          }),
        ),
        ...[...byWorkspace].map(([key, edited]) => {
          const [contentRepositoryId, workspaceName] = JSON.parse(key) as [
            string,
            string,
          ]
          return invalidateAfterContentEdit(
            contentRepositoryId,
            workspaceName,
            edited,
          )
        }),
      ]),
    )
  },
  afterStructuralEdit: ({ contentRepositoryId, workspaceName }) =>
    settled(afterStructuralEdit(contentRepositoryId, workspaceName)),
  afterPublish: ({ contentRepositoryId, workspaceName }) =>
    settled(afterPublish(contentRepositoryId, workspaceName)),
  afterWorkspaceRewrite: ({ contentRepositoryId, workspaceName }) =>
    settled(afterWorkspaceRewrite(contentRepositoryId, workspaceName)),
  afterWorkspacesChanged: () => settled(invalidateWorkspaceQueries()),
}
