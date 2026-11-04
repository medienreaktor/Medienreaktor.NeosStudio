import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { dimensionSpacePointKey, type DimensionSpacePoint } from './dimensions'
import { queryKeys } from './keys'

/**
 * The conversation about a workspace's pending changes.
 *
 * Comments hang off the WORKSPACE, not off a task: the review that happens in
 * most installations is a shared draft against live, which is no task branch.
 * A task's thread is the same thread - the comment its author wrote when
 * submitting, the reason a reviewer handed it back, and everything said since.
 *
 * A comment either belongs to the general thread or is PINNED to one change:
 * one node, in one dimension, on one page. All three are needed to name a
 * change, because the same element is edited independently per dimension.
 */

export interface ReviewComment {
  id: number
  author: string | null
  /** Resolved server-side, so it never depends on the users listing. */
  authorLabel: string | null
  text: string
  createdAt: string
  /** The pinned change, or null for the workspace's general thread. */
  documentAggregateId: string | null
  nodeAggregateId: string | null
  dimensions: DimensionSpacePoint | null
  /** Settled remarks fold away instead of piling up. */
  resolvedAt: string | null
  resolvedBy: string | null
}

/**
 * Identity of the change a comment is pinned to - the key its thread is
 * grouped under. Empty string for the general thread.
 */
export function commentAnchorKey(
  nodeAggregateId: string | null | undefined,
  dimensions: DimensionSpacePoint | null | undefined,
): string {
  if (!nodeAggregateId) return ''
  return `${nodeAggregateId}@${dimensionSpacePointKey(dimensions)}`
}

/** The key of the change a comment sits on. */
export function anchorKeyOf(comment: ReviewComment): string {
  return commentAnchorKey(comment.nodeAggregateId, comment.dimensions)
}

/**
 * The whole conversation of one workspace, oldest first - general and pinned
 * comments in one response. One request per review, not one per change: the
 * compare view steps through dozens of changes and must not fetch on each.
 *
 * Pass null while no workspace is under review.
 */
export function useReviewComments(workspaceName: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.workspaces.comments(workspaceName ?? ''),
    queryFn: () =>
      apiFetch<{ comments: ReviewComment[] }>(
        `/workspaces/${encodeURIComponent(workspaceName ?? '')}/comments`,
      ),
    enabled: enabled && workspaceName !== null,
  })
}

export interface AddReviewCommentInput {
  text: string
  /** Pin the comment to one change; omit for the general thread. */
  documentAggregateId?: string
  nodeAggregateId?: string
  dimensions?: DimensionSpacePoint
}

export function addReviewComment(
  workspaceName: string,
  input: AddReviewCommentInput,
): Promise<{ comment: ReviewComment }> {
  return apiFetch<{ comment: ReviewComment }>(
    `/workspaces/${encodeURIComponent(workspaceName)}/comments`,
    { method: 'POST', body: input },
  )
}

export function resolveReviewComment(
  workspaceName: string,
  commentId: number,
  resolved: boolean,
): Promise<{ comment: ReviewComment | null }> {
  return apiFetch<{ comment: ReviewComment | null }>(
    `/workspaces/${encodeURIComponent(workspaceName)}/comments/${commentId}/resolve`,
    { method: 'POST', body: { resolved } },
  )
}

export function deleteReviewComment(
  workspaceName: string,
  commentId: number,
): Promise<{ deleted: number }> {
  return apiFetch<{ deleted: number }>(
    `/workspaces/${encodeURIComponent(workspaceName)}/comments/${commentId}`,
    { method: 'DELETE' },
  )
}

/**
 * The comments of a review, split the way the UI reads them: the general
 * thread, and the pinned ones grouped by the change they sit on.
 */
export function groupComments(comments: ReviewComment[]): {
  general: ReviewComment[]
  byAnchor: Map<string, ReviewComment[]>
  /** Open (unresolved) pinned comments per document - the page-level badge. */
  openByDocument: Map<string, number>
} {
  const general: ReviewComment[] = []
  const byAnchor = new Map<string, ReviewComment[]>()
  const openByDocument = new Map<string, number>()
  for (const comment of comments) {
    const key = anchorKeyOf(comment)
    if (key === '') {
      general.push(comment)
      continue
    }
    byAnchor.set(key, [...(byAnchor.get(key) ?? []), comment])
    if (comment.resolvedAt === null && comment.documentAggregateId) {
      openByDocument.set(
        comment.documentAggregateId,
        (openByDocument.get(comment.documentAggregateId) ?? 0) + 1,
      )
    }
  }
  return { general, byAnchor, openByDocument }
}
