import { useState } from 'react'
import { PencilIcon, Trash2Icon } from 'lucide-react'

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
import { ConfirmDialog } from './ConfirmDialog'

/** A collection or tag the context menu was opened for. */
export interface MediaMenuTarget {
  kind: 'collection' | 'tag'
  id: string
  label: string
  /** Viewport point the right-click happened at, to anchor the menu. */
  anchor: { x: number; y: number }
}

const NOUN: Record<MediaMenuTarget['kind'], string> = {
  collection: 'collection',
  tag: 'tag',
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
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                setDeleting(target)
                onClose()
              }}
            >
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <RenameDialog target={renaming} onClose={() => setRenaming(null)} />

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete this ${deleting ? NOUN[deleting.kind] : ''}?`}
        description={
          deleting?.kind === 'collection'
            ? `“${deleting.label}” will be removed. The assets inside it are kept.`
            : deleting
              ? `“${deleting.label}” will be removed from all assets. The assets are kept.`
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
          <DialogTitle>Rename {target ? NOUN[target.kind] : ''}</DialogTitle>
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
            Cancel
          </Button>
          <Button disabled={busy || !value.trim()} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
