import {
  invalidateWorkspaceChanges,
  invalidateWorkspaceHistory,
} from '@/api/neos/endpoints/workspaces'
import { neosKeys } from '@/api/neos/keys'
import type { Workspace } from '@/api/neos/schema'
import { queryClient } from '@/app/queryClient'

/**
 * Refresh everything workspace-related: Neos.Api's workspace reads (the list,
 * changes, roles, events - and what the review, pending history and trash are
 * made of) - after a write that may affect any of them: publish, discard,
 * rebase, a base workspace change, a workspace created or deleted.
 */
export function invalidateWorkspaceQueries(): Promise<unknown> {
  return queryClient.invalidateQueries({ queryKey: neosKeys.workspaces.all })
}

/**
 * Refresh what a content edit in one workspace changes: its changes (and the
 * review, trash and conflicts made of them) and its pending history - not the
 * workspace list, roles or other workspaces. For property and reference saves,
 * local or remote, which come often (a typing colleague saves every few
 * seconds).
 */
export function invalidateAfterContentEdit(
  contentRepositoryId: string,
  workspaceName: string,
): Promise<unknown> {
  const listKey = neosKeys.workspaces.list(contentRepositoryId)
  // The first edit makes the workspace publishable: then (and only then) the
  // list's hasPublishableChanges flag is stale too.
  const listed = queryClient
    .getQueryData<Workspace[]>(listKey)
    ?.find((workspace) => workspace.name === workspaceName)
  return Promise.all([
    invalidateWorkspaceChanges(contentRepositoryId, workspaceName),
    invalidateWorkspaceHistory(contentRepositoryId, workspaceName),
    listed && !listed.hasPublishableChanges
      ? queryClient.invalidateQueries({ queryKey: listKey })
      : null,
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
