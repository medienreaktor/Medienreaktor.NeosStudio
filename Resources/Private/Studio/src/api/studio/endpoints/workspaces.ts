import { useQueries, useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { queryString } from '../../http/request'
import {
  activeContentRepositoryId,
  useActiveContentRepositoryId,
} from '../../neos/activeContentRepository'
import { contentRepositoryPath } from '../../neos/client'
import { restoreNode } from '../../neos/endpoints/nodeCommands'
import { studioFetch } from '../client'
import { studioKeys } from '../keys'
import type {
  ConflictingNodes,
  WorkspaceDocumentChanges,
  WorkspaceDocumentDiff,
  WorkspacePendingEvents,
  WorkspacePendingEventsDiff,
  WorkspaceTrash,
} from '../schema'

/**
 * The Studio's read models of a workspace, beyond what Neos.Api offers: the
 * review (changes grouped by document, net diffs), the pending history and
 * the trash bin (the Studio API's WorkspaceHistory,
 * /api/cr/{contentRepositoryId}/workspaces/{workspaceName}/...), in the
 * selected site's content repository.
 */

function workspacePath(
  contentRepositoryId: string,
  workspaceName: string,
  suffix: string,
): string {
  return `${contentRepositoryPath(contentRepositoryId)}/workspaces/${encodeURIComponent(workspaceName)}${suffix}`
}

/** The workspace's changes grouped by their document, for the review dialog. */
export function useWorkspaceDocumentChanges(
  workspaceName: string | null,
  enabled = true,
) {
  const contentRepositoryId = useActiveContentRepositoryId()
  return useQuery({
    queryKey: studioKeys.workspaces.documentChanges(
      contentRepositoryId ?? '',
      workspaceName ?? '',
    ),
    queryFn: () =>
      studioFetch<WorkspaceDocumentChanges>(
        workspacePath(contentRepositoryId!, workspaceName!, '/documentchanges'),
      ),
    enabled: workspaceName !== null && contentRepositoryId !== null && enabled,
    // Read afresh whenever the review opens: changes made elsewhere (another
    // tab, a colleague, the classic UI) invalidate nothing here, and a review
    // must never offer a stale "no pending changes".
    staleTime: 0,
  })
}

/**
 * The net state diff of one document's changed nodes (workspace vs base).
 * Lazy: fetched when a review row is unfolded.
 */
export function useWorkspaceDocumentDiff(
  workspaceName: string | null,
  documentAggregateId: string | null,
  enabled = true,
) {
  const contentRepositoryId = useActiveContentRepositoryId()
  return useQuery({
    queryKey: studioKeys.workspaces.documentDiff(
      contentRepositoryId ?? '',
      workspaceName ?? '',
      documentAggregateId ?? '',
    ),
    queryFn: () =>
      studioFetch<WorkspaceDocumentDiff>(
        workspacePath(
          contentRepositoryId!,
          workspaceName!,
          `/documentdiff${queryString({ documentAggregateId })}`,
        ),
      ),
    enabled:
      enabled &&
      workspaceName !== null &&
      documentAggregateId !== null &&
      contentRepositoryId !== null,
    // Mirrors the changes queries: state diffs go stale with further edits.
    staleTime: 10_000,
  })
}

/**
 * The conflicting nodes of a failed rebase or publish with their labels and
 * documents - Neos.Api names them by id only.
 */
export function useConflictDetails(
  workspaceName: string | null,
  nodeAggregateIds: string[],
) {
  const contentRepositoryId = useActiveContentRepositoryId()
  const ids = [...new Set(nodeAggregateIds)].sort()
  return useQuery({
    queryKey: studioKeys.workspaces.conflictDetails(
      contentRepositoryId ?? '',
      workspaceName ?? '',
      ids,
    ),
    queryFn: () =>
      studioFetch<ConflictingNodes>(
        workspacePath(
          contentRepositoryId!,
          workspaceName!,
          `/conflictingnodes${queryString({ nodeAggregateIds: ids.join(',') })}`,
        ),
      ),
    enabled:
      workspaceName !== null && contentRepositoryId !== null && ids.length > 0,
    staleTime: Infinity,
    select: (response) => response.nodes,
  })
}

/**
 * Before/after detail for one editing step (a sequence-number slice of the
 * pending history). Lazy: fetched when a step's detail is opened.
 */
export function useWorkspacePendingEventsDiff(
  workspaceName: string | null,
  from: number | null,
  to: number | null,
) {
  const contentRepositoryId = useActiveContentRepositoryId()
  return useQuery({
    queryKey: studioKeys.workspaces.pendingEventsDiff(
      contentRepositoryId ?? '',
      workspaceName ?? '',
      from ?? 0,
      to ?? 0,
    ),
    queryFn: () =>
      studioFetch<WorkspacePendingEventsDiff>(
        workspacePath(
          contentRepositoryId!,
          workspaceName!,
          `/pendingevents/diff${queryString({ from, to })}`,
        ),
      ),
    enabled:
      workspaceName !== null &&
      contentRepositoryId !== null &&
      from !== null &&
      to !== null,
    // The slice is immutable (events never change once recorded); only a
    // stream swap invalidates it, and that changes the key via from/to.
    staleTime: Infinity,
  })
}

/**
 * The pending histories of several workspaces at once (the Workspaces graph
 * fetches one per visible branch), by workspace name; entries are absent
 * while loading or on error.
 */
export function useWorkspacesPendingEvents(
  workspaceNames: string[],
  enabled = true,
  refetchInterval?: number,
) {
  const contentRepositoryId = useActiveContentRepositoryId()
  return useQueries({
    queries: workspaceNames.map((name) => ({
      queryKey: studioKeys.workspaces.pendingEvents(
        contentRepositoryId ?? '',
        name,
      ),
      queryFn: () =>
        studioFetch<WorkspacePendingEvents>(
          workspacePath(contentRepositoryId!, name, '/pendingevents'),
        ),
      enabled: enabled && contentRepositoryId !== null,
      refetchInterval,
    })),
    combine: (results) => {
      const byWorkspace = new Map<string, WorkspacePendingEvents>()
      results.forEach((result, index) => {
        if (result.data) byWorkspace.set(workspaceNames[index], result.data)
      })
      return {
        byWorkspace,
        isLoading: results.some((result) => result.isLoading),
      }
    },
  })
}

/**
 * The workspace's deleted PAGES. Deleted content elements are left out: they
 * are restored where they are edited, and would take up room in a capped
 * list that belongs to the pages.
 */
export function useWorkspaceTrash(workspaceName: string | null) {
  const contentRepositoryId = useActiveContentRepositoryId()
  return useQuery({
    queryKey: studioKeys.workspaces.trash(
      contentRepositoryId ?? '',
      workspaceName ?? '',
    ),
    queryFn: () =>
      studioFetch<WorkspaceTrash>(
        workspacePath(
          contentRepositoryId!,
          workspaceName!,
          `/trash${queryString({ filterByDocuments: true })}`,
        ),
      ),
    enabled: workspaceName !== null && contentRepositoryId !== null,
  })
}

/**
 * Restores a deleted node of the trash (Neos.Api's restoreNode), together
 * with any deleted ancestor it lives inside. A 409 while the workspace is
 * outdated or when the node is not deleted itself - the problem's detail says
 * which. Resolves with what was restored, taken from the trash listing the
 * restore was offered from.
 */
export async function restoreFromTrash(
  workspaceName: string,
  nodeAggregateId: string,
): Promise<{ nodeAggregateId: string; label: string | null }[]> {
  const contentRepositoryId = activeContentRepositoryId()
  const item = queryClient
    .getQueryData<WorkspaceTrash>(
      studioKeys.workspaces.trash(contentRepositoryId, workspaceName),
    )
    ?.items.find((candidate) => candidate.nodeAggregateId === nodeAggregateId)
  await restoreNode({ contentRepositoryId, workspaceName, nodeAggregateId })
  return [
    { nodeAggregateId, label: item?.label ?? null },
    ...(item?.restoresAncestors ?? []),
  ]
}
