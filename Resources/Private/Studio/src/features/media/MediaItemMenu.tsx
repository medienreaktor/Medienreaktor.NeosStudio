import { useState } from 'react'

import {
  deleteCollection,
  deleteTag,
  updateCollection,
  updateTag,
} from '@/api/media'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { translate as t } from '@/lib/i18n'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

/** A collection or tag the context menu was opened for. */
export interface MediaMenuTarget {
  kind: 'collection' | 'tag'
  id: string
  label: string
  /** Viewport point the right-click happened at, to anchor the menu. */
  anchor: { x: number; y: number }
}

/** The human-readable noun for a menu target, translated at call time. */
function nounLabel(kind: MediaMenuTarget['kind']): string {
  return kind === 'collection'
    ? t('media.nounCollection', 'collection')
    : t('media.nounTag', 'tag')
}

/**
 * The right-click actions for a collection or tag: rename and delete. Mirrors
 * the document tree's NodeContextMenu - an invisible anchor at the click point,
 * with the rename and delete dialogs rendered unconditionally so they survive
 * the menu closing. Runs the writes itself (which invalidate the media caches).
 */
export function MediaItemActions({
  target,
  onClose,
}: {
  target: MediaMenuTarget | null
  onClose: () => void
}) {
  const [renaming, setRenaming] = useState<MediaMenuTarget | null>(null)
  const [deleting, setDeleting] = useState<MediaMenuTarget | null>(null)

  const remove = (item: MediaMenuTarget) =>
    item.kind === 'collection' ? deleteCollection(item.id) : deleteTag(item.id)

  return (
    <>
      {target && (
        <DropdownMenu open onOpenChange={(open) => !open && onClose()}>
          <DropdownMenuTrigger
            aria-hidden
            tabIndex={-1}
            style={{
              position: 'fixed',
              left: target.anchor.x,
              top: target.anchor.y,
              width: 1,
              height: 1,
              opacity: 0,
              pointerEvents: 'none',
            }}
          />
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onClick={() => {
                setRenaming(target)
                onClose()
              }}
            >
              <i className="fas fa-fw fa-pen" aria-hidden />
              {t('media.rename', 'Rename')}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                setDeleting(target)
                onClose()
              }}
            >
              <i className="fas fa-fw fa-trash-can" aria-hidden />
              {t('media.delete', 'Delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <RenameDialog target={renaming} onClose={() => setRenaming(null)} />

      <ConfirmDialog
        open={deleting !== null}
        title={
          deleting
            ? t('media.deleteThis', 'Delete this {0}?', [
                nounLabel(deleting.kind),
              ])
            : ''
        }
        description={
          deleting?.kind === 'collection'
            ? t(
                'media.deleteCollectionDescription',
                '“{0}” will be removed. The assets inside it are kept.',
                [deleting.label],
              )
            : deleting
              ? t(
                  'media.deleteTagDescription',
                  '“{0}” will be removed from all assets. The assets are kept.',
                  [deleting.label],
                )
              : undefined
        }
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
      />
    </>
  )
}

function RenameDialog({
  target,
  onClose,
}: {
  target: MediaMenuTarget | null
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  // Reset the field whenever a new target opens the dialog.
  const [seen, setSeen] = useState<string | null>(null)
  if (target && seen !== target.id) {
    setSeen(target.id)
    setValue(target.label)
  }
  if (!target && seen !== null) setSeen(null)

  async function save() {
    const trimmed = value.trim()
    if (!trimmed || !target) return
    setBusy(true)
    try {
      if (target.kind === 'collection')
        await updateCollection(target.id, trimmed)
      else await updateTag(target.id, { label: trimmed })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => !open && !busy && onClose()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {target
              ? t('media.renameNoun', 'Rename {0}', [nounLabel(target.kind)])
              : ''}
          </DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
          }}
        />
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t('media.cancel', 'Cancel')}
          </Button>
          <Button disabled={busy || !value.trim()} onClick={save}>
            {busy ? t('media.saving', 'Saving…') : t('media.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
