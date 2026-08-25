import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/client'
import type { DimensionSpacePoint } from '@/api/dimensions'
import { queryKeys } from '@/api/keys'
import { useMe } from '@/api/me'
import {
  addReviewComment,
  deleteReviewComment,
  resolveReviewComment,
  type ReviewComment,
} from '@/api/reviewComments'
import { queryClient } from '@/app/queryClient'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import {
  presenceColor,
  presenceInitials,
} from '@/features/collaboration/presenceColors'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * The conversation of a review, social-media style: avatar, name + bubble,
 * relative time, composer at the bottom (Enter sends, Shift+Enter breaks).
 *
 * One component for both kinds of thread the review has. Without an anchor it
 * is the workspace's general discussion - what the task board and the review
 * dialog show. With one it is the conversation about a single change, pinned
 * to a node in one dimension, which is what the compare view puts next to the
 * two rendered versions.
 *
 * Pinned remarks can be settled: an unresolved one is something still to do,
 * and folding away the rest is what keeps a long-lived draft's review
 * readable. General remarks cannot - a discussion is not a to-do list.
 */
export function CommentThread({
  workspaceName,
  comments,
  anchor,
  canManage = false,
  placeholder,
  emptyLabel,
  className,
  listClassName,
}: {
  workspaceName: string
  /** Already filtered to this thread by the caller (one query per review). */
  comments: ReviewComment[]
  /** Pins new comments to one change; omit for the general thread. */
  anchor?: {
    documentAggregateId: string
    nodeAggregateId: string
    dimensions: DimensionSpacePoint
  }
  /** Manage permission on the workspace - allows removing others' comments. */
  canManage?: boolean
  placeholder?: string
  emptyLabel?: string
  className?: string
  listClassName?: string
}) {
  const [text, setText] = useState('')
  const { data: me } = useMe()

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.workspaces.comments(workspaceName),
    })
    // The board's per-card comment count lives on the tasks query.
    void queryClient.invalidateQueries({ queryKey: queryKeys.tasks })
  }

  const send = useMutation({
    mutationFn: () =>
      addReviewComment(workspaceName, { text: text.trim(), ...anchor }),
    onSuccess: () => {
      setText('')
      invalidate()
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('review.commentFailedDetail', 'Adding the comment failed.'),
        ),
        { title: t('review.commentFailed', 'Could not add comment') },
      ),
  })

  const resolve = useMutation({
    mutationFn: ({ id, resolved }: { id: number; resolved: boolean }) =>
      resolveReviewComment(workspaceName, id, resolved),
    onSuccess: invalidate,
    onError: (error) =>
      toast.error(error, {
        title: t('review.resolveFailed', 'Could not update the comment'),
      }),
  })

  const remove = useMutation({
    mutationFn: (id: number) => deleteReviewComment(workspaceName, id),
    onSuccess: invalidate,
    onError: (error) =>
      toast.error(error, {
        title: t('review.deleteFailed', 'Could not delete the comment'),
      }),
  })

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (text.trim() !== '' && !send.isPending) send.mutate()
  }

  return (
    <div className={className}>
      <div className={cn('flex flex-col gap-3', listClassName)}>
        {comments.length === 0 && (
          <div className="text-xs text-neutral-500">
            {emptyLabel ?? t('review.noComments', 'No comments yet.')}
          </div>
        )}
        {comments.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            canResolve={comment.nodeAggregateId !== null}
            canDelete={
              canManage ||
              (me?.user?.id != null && me.user.id === comment.author)
            }
            busy={resolve.isPending || remove.isPending}
            onResolve={(resolved) =>
              resolve.mutate({ id: comment.id, resolved })
            }
            onDelete={() => remove.mutate(comment.id)}
          />
        ))}
      </div>

      <form onSubmit={submit} className="mt-3 flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder={
            placeholder ?? t('review.commentPlaceholder', 'Write a comment…')
          }
          rows={anchor ? 2 : 3}
          className="flex-1"
        />
        <Button
          type="submit"
          size="icon"
          title={t('review.commentSend', 'Send')}
          aria-label={t('review.commentSend', 'Send')}
          disabled={text.trim() === '' || send.isPending}
        >
          <i
            className={`fas ${send.isPending ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`}
            aria-hidden
          />
        </Button>
      </form>
    </div>
  )
}

function CommentItem({
  comment,
  canResolve,
  canDelete,
  busy,
  onResolve,
  onDelete,
}: {
  comment: ReviewComment
  canResolve: boolean
  canDelete: boolean
  busy: boolean
  onResolve: (resolved: boolean) => void
  onDelete: () => void
}) {
  const resolved = comment.resolvedAt !== null
  return (
    <div className={cn('group flex items-start gap-2', resolved && 'opacity-60')}>
      <span
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-semibold text-white select-none"
        style={{
          backgroundColor: comment.author
            ? presenceColor(comment.author)
            : 'var(--color-neutral-700)',
        }}
        aria-hidden
      >
        {presenceInitials(comment.authorLabel ?? '?')}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'w-fit max-w-full rounded-lg rounded-tl-none px-3 py-1.5',
            resolved
              ? 'bg-neutral-100 dark:bg-neutral-900'
              : 'bg-neutral-200 dark:bg-neutral-800',
          )}
        >
          <div className="text-xs font-semibold text-neutral-950 dark:text-white">
            {comment.authorLabel ?? comment.author}
          </div>
          <div className="text-sm wrap-break-word whitespace-pre-line text-neutral-800 dark:text-neutral-200">
            {comment.text}
          </div>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[0.65rem] text-neutral-500">
          <span title={new Date(comment.createdAt).toLocaleString()}>
            {timeAgo(comment.createdAt)}
          </span>
          {resolved && (
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <i className="fas fa-check" aria-hidden />
              {t('review.resolved', 'Done')}
            </span>
          )}
          {/* Kept out of the way until the comment is pointed at - a thread
              is for reading first. */}
          <span className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {canResolve && (
              <button
                type="button"
                className="cursor-pointer hover:text-neutral-950 dark:hover:text-white"
                disabled={busy}
                onClick={() => onResolve(!resolved)}
              >
                {resolved
                  ? t('review.unresolve', 'Reopen')
                  : t('review.resolve', 'Mark done')}
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className="cursor-pointer hover:text-red-600 dark:hover:text-red-400"
                disabled={busy}
                onClick={onDelete}
              >
                {t('action.delete', 'Delete')}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}

/** "5 min ago"-style timestamp; older than a week reads as a plain date. */
export function timeAgo(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (seconds < 60) return format.format(0, 'minute')
  if (seconds < 3600) return format.format(-Math.floor(seconds / 60), 'minute')
  if (seconds < 86400) return format.format(-Math.floor(seconds / 3600), 'hour')
  if (seconds < 604800)
    return format.format(-Math.floor(seconds / 86400), 'day')
  return new Date(iso).toLocaleDateString()
}
