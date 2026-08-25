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
 * Handing a task back: the reviewer's "not yet", with what needs doing.
 *
 * The reason is required, not optional. A review that returns work without
 * saying why is the one thing worse than no review at all, and the person
 * picking the task back up has nothing to go on. It joins the task's comment
 * thread, so it is still there when they do.
 */
export function RequestChangesDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onSubmit: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (open) setReason('')
  }, [open])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!pending && reason.trim() !== '') onSubmit(reason.trim())
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('review.requestChanges', 'Request changes')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'review.requestChangesHint',
              'The task goes back to its author. Nothing is published and nothing is discarded — their work stays as it is.',
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <Field
            label={t('review.requestChangesReason', 'What needs to change?')}
            htmlFor="review-request-changes-reason"
          >
            <Textarea
              id="review-request-changes-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              autoFocus
              required
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
            <Button type="submit" disabled={pending || reason.trim() === ''}>
              <i
                className={`fas fa-fw ${pending ? 'fa-spinner fa-spin' : 'fa-rotate-left'}`}
                aria-hidden
              />
              {t('review.requestChanges', 'Request changes')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
