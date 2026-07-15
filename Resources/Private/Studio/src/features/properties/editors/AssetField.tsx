import { useState } from 'react'
import { ImageIcon, Loader2Icon, PaperclipIcon, XIcon } from 'lucide-react'

import { useAsset, type MediaAsset } from '@/api/media'
import { Button } from '@/components/ui/button'
import { useAssetPicker } from '@/features/media/AssetPicker'
import { AssetThumb } from '@/features/media/AssetThumb'
import { formatBytes } from '@/features/media/format'
import type { PropertyEditorProps } from '../registry'
import {
  assetReference,
  imageReference,
  localIdentifierFor,
  referenceIdentifier,
} from './assetValue'

/**
 * The shared body of the Asset and Image editors: shows the currently
 * referenced asset (thumbnail/preview + label) and hands off to the Media
 * Library in picker mode to choose another. `kind` is the whole difference -
 * "image" commits an Image reference and shows a large preview; "asset" commits
 * a reference of the picked asset's concrete type and shows a compact row.
 *
 * A stored value is only ever an identifier (see assetValue.ts), so the asset
 * to display is resolved from the API. A fresh pick is held locally too, so the
 * preview updates instantly, ahead of the resolve. State is seeded once from
 * `value` and thereafter owned here - the inspector remounts the editor (keyed
 * by node + property) when the edited subject changes, which resets it.
 */
export function AssetField({
  subject,
  value,
  onCommit,
  kind,
}: PropertyEditorProps & { kind: 'image' | 'asset' }) {
  const { requestPick } = useAssetPicker()
  const [identifier, setIdentifier] = useState(() => referenceIdentifier(value))
  const [picked, setPicked] = useState<MediaAsset | null>(null)

  // Stored identifiers are always local, so they resolve against 'neos'.
  const query = useAsset('neos', identifier)
  const asset = picked ?? query.data ?? null

  const select = () => {
    requestPick({
      title: subject.label,
      onPick: async (chosen) => {
        const id = await localIdentifierFor(chosen)
        setPicked(chosen)
        setIdentifier(id)
        onCommit(
          kind === 'image' ? imageReference(id) : assetReference(chosen, id),
        )
      },
    })
  }

  const clear = () => {
    setPicked(null)
    setIdentifier(null)
    onCommit(null)
  }

  if (!identifier) {
    const Icon = kind === 'image' ? ImageIcon : PaperclipIcon
    return (
      <button
        type="button"
        onClick={select}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-neutral-700 bg-neutral-950 px-3 py-4 text-sm text-neutral-400 hover:border-neutral-500 hover:text-white"
      >
        <Icon className="size-4" />
        {kind === 'image' ? 'Select image…' : 'Select asset…'}
      </button>
    )
  }

  // Resolving the identifier for the first time, with nothing to show yet.
  const loading = !asset && query.isLoading
  // Resolved to nothing - a dangling reference (asset deleted, or not visible).
  const missing = !asset && !query.isLoading

  if (kind === 'image') {
    return (
      <div>
        <div className="group relative overflow-hidden rounded-md border border-neutral-700 bg-neutral-950">
          <div className="flex min-h-24 items-center justify-center p-2">
            {asset ? (
              <AssetThumb asset={asset} preview className="max-h-48" />
            ) : loading ? (
              <Loader2Icon className="size-5 animate-spin text-neutral-500" />
            ) : (
              <span className="py-6 text-xs text-neutral-500">
                Asset not found
              </span>
            )}
          </div>
          {/* Covers the preview: invisible until hover, but clickable throughout
              so a click anywhere on the preview reselects. */}
          <button
            type="button"
            onClick={select}
            className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <span className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white">
              Select…
            </span>
          </button>
          <Button
            variant="secondary"
            size="icon-xs"
            onClick={clear}
            title="Remove"
            className="absolute top-1 right-1 z-10"
          >
            <XIcon />
          </Button>
        </div>
        {asset && (
          <div
            className="mt-1 truncate text-xs text-neutral-400"
            title={asset.label}
          >
            {asset.label}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 rounded-md border border-neutral-700 bg-neutral-950 p-2">
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
      <Button variant="outline" size="sm" onClick={select}>
        Select…
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={clear} title="Remove">
        <XIcon />
      </Button>
    </div>
  )
}
