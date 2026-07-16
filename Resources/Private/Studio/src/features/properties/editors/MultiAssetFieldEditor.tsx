import { useState } from 'react'
import {
  GripVerticalIcon,
  Loader2Icon,
  PaperclipIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react'

import { useAsset, type MediaAsset } from '@/api/media'
import { Button } from '@/components/ui/button'
import { useAssetPicker } from '@/features/media/AssetPicker'
import { AssetThumb } from '@/features/media/AssetThumb'
import { formatBytes } from '@/features/media/format'
import { cn } from '@/lib/utils'
import type { PropertyEditorProps } from '../registry'
import {
  assetReference,
  imageReference,
  localIdentifierFor,
  referenceList,
  type AssetReference,
} from './assetValue'

/**
 * A collection asset/image property (`array<Neos\Media\Domain\Model\Asset>`).
 * Sibling to AssetFieldEditor (the single-value case): the difference is the
 * stored value is a *list* of references, so committing a single reference
 * object - as AssetFieldEditor does - is rejected by the CR ("must be of type
 * array<Asset>").
 *
 * Picking is one-at-a-time (the Media Library owns the screen for a pick, one
 * session live at a time), so this appends the chosen asset to the list. Order
 * is meaningful (it is the stored order), so rows can be dragged to reorder.
 * Each row resolves its asset from the API for display; a fresh pick is cached
 * locally so it shows instantly, ahead of the resolve. State is seeded once
 * from `value` and thereafter owned here - the inspector remounts the editor
 * (keyed by node + property) when the edited subject changes, which resets it.
 */
export function MultiAssetFieldEditor({
  subject,
  value,
  onCommit,
  kind,
}: PropertyEditorProps & { kind: 'image' | 'asset' }) {
  const { requestPick } = useAssetPicker()
  const [refs, setRefs] = useState<AssetReference[]>(() => referenceList(value))
  // Freshly picked assets, so a new row shows before its resolve lands.
  const [pickedById, setPickedById] = useState<Record<string, MediaAsset>>({})
  // The row being dragged, tracked while a reorder is in progress.
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  // Committing an empty list unsets the property, matching the single editor.
  const commit = (next: AssetReference[]) => {
    setRefs(next)
    onCommit(next.length ? next : null)
  }

  const add = () => {
    requestPick({
      title: subject.label,
      onPick: async (chosen) => {
        const id = await localIdentifierFor(chosen)
        // The same asset twice would just be a confusing duplicate row.
        if (refs.some((ref) => ref.__identifier === id)) return
        setPickedById((cache) => ({ ...cache, [id]: chosen }))
        commit([
          ...refs,
          kind === 'image' ? imageReference(id) : assetReference(chosen, id),
        ])
      },
    })
  }

  const remove = (id: string) =>
    commit(refs.filter((ref) => ref.__identifier !== id))

  // Reorder live as the pointer passes over another row - immediate feedback,
  // but the new order is only persisted on drop (handleDragEnd), so a drag does
  // not fire an auto-save per hovered row.
  const handleDragOver = (index: number) => {
    if (dragIndex === null || dragIndex === index) return
    setRefs((current) => {
      const next = [...current]
      const [moved] = next.splice(dragIndex, 1)
      next.splice(index, 0, moved)
      return next
    })
    setDragIndex(index)
  }

  const handleDragEnd = () => {
    setDragIndex(null)
    onCommit(refs.length ? refs : null)
  }

  return (
    <div className="flex flex-col gap-2">
      {refs.map((ref, index) => (
        <AssetRow
          key={ref.__identifier}
          identifier={ref.__identifier}
          picked={pickedById[ref.__identifier] ?? null}
          dragging={dragIndex === index}
          onDragStart={() => setDragIndex(index)}
          onDragOver={() => handleDragOver(index)}
          onDragEnd={handleDragEnd}
          onRemove={() => remove(ref.__identifier)}
        />
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={add}
        className="justify-center"
      >
        <PlusIcon className="size-4" />
        {kind === 'image' ? 'Add image…' : 'Add asset…'}
      </Button>
    </div>
  )
}

/**
 * One row of the collection: resolves its asset by identifier (unless a fresh
 * pick is supplied) and shows a compact thumbnail + label, with a drag handle
 * to reorder and a remove button. The whole row is draggable; the grip is the
 * affordance.
 */
function AssetRow({
  identifier,
  picked,
  dragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  onRemove,
}: {
  identifier: string
  picked: MediaAsset | null
  dragging: boolean
  onDragStart: () => void
  onDragOver: () => void
  onDragEnd: () => void
  onRemove: () => void
}) {
  // Stored identifiers are always local, so they resolve against 'neos'. A
  // fresh pick needs no fetch.
  const query = useAsset('neos', picked ? null : identifier)
  const asset = picked ?? query.data ?? null
  const loading = !asset && query.isLoading
  const missing = !asset && !query.isLoading

  return (
    <div
      draggable
      onDragStart={(event) => {
        // Firefox only starts a drag once dataTransfer carries something.
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', identifier)
        onDragStart()
      }}
      onDragOver={(event) => {
        event.preventDefault()
        onDragOver()
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-950 p-2',
        dragging && 'opacity-50',
      )}
    >
      <GripVerticalIcon className="size-4 shrink-0 cursor-grab text-neutral-600" />
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded bg-neutral-900">
        {asset ? (
          <AssetThumb asset={asset} />
        ) : loading ? (
          <Loader2Icon className="size-4 animate-spin text-neutral-500" />
        ) : (
          <PaperclipIcon className="size-5 text-neutral-600" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm" title={asset?.label}>
          {asset ? asset.label : missing ? 'Asset not found' : 'Loading…'}
        </div>
        {asset && (
          <div className="truncate text-xs text-neutral-400">
            {formatBytes(asset.fileSize)}
          </div>
        )}
      </div>
      <Button variant="ghost" size="icon-sm" onClick={onRemove} title="Remove">
        <XIcon />
      </Button>
    </div>
  )
}
