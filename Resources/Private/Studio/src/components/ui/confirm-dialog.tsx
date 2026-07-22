import { useState } from 'react'

import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: React.ReactNode
  /** Confirm button label (default "Delete"). */
  confirmLabel?: string
  /** Style the confirm button as destructive (default true). */
  destructive?: boolean
  onOpenChange: (open: boolean) => void
  /** May return a promise; the dialog shows a busy state and closes on success. */
  onConfirm: () => void | Promise<void>
}

/**
 * A yes/no confirmation dialog, used for every destructive action (deleting
 * assets, collections, tags, users, ...) so nothing is removed without a
 * deliberate confirm. Awaits an async onConfirm and surfaces failures as a
 * toast while staying open.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = true,
  onOpenChange,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (e) {
      toast.error(
        e instanceof Error ? e : t('common.actionFailed', 'The action failed.'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy}
            onClick={confirm}
          >
            {busy
              ? t('common.working', 'Working…')
              : (confirmLabel ?? t('common.delete', 'Delete'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
