import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { translate as t } from '@/lib/i18n'

/**
 * Confirm handing a task to the reviewers, with an optional comment for
 * them - it joins the task's comment thread and rides along in the review
 * notification.
 */
export function SendToReviewDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onSubmit: (comment: string) => void
}) {
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (open) setComment('')
  }, [open])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!pending) onSubmit(comment.trim())
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('tasks.sendToReview', 'Send to review')}</DialogTitle>
          <DialogDescription>
            {t(
              'tasks.sendToReviewHint',
              'Hand the task to the reviewers. A comment helps them know what to look at.',
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <Field
            label={t('tasks.reviewComment', 'Comment (optional)')}
            htmlFor="task-review-comment"
          >
            <Textarea
              id="task-review-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={3}
            />
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              <i
                className={`fas ${pending ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`}
                aria-hidden
              />
              {t('tasks.sendToReview', 'Send to review')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
