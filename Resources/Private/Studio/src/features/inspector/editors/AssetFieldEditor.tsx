import { useMemo, useState } from 'react'

import { useAsset, type MediaAsset } from '@/api/media'
import { Button } from '@/components/ui/button'
import { useAssetPicker } from '@/features/media/AssetPicker'
import { AssetThumb } from '@/features/media/AssetThumb'
import type { PropertyEditorProps } from './registry'
import {
  assetReference,
  imageReference,
  imageVariantReference,
  localIdentifierFor,
  referenceIdentifier,
} from '@/api/assetValue'
import { parseCropConfig } from './cropOptions'
import { ImageCropDialog } from './ImageCropDialog'
import { translate as t } from '@/lib/i18n'

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
export function AssetFieldEditor({
  subject,
  value,
  onCommit,
  options,
  kind,
}: PropertyEditorProps & { kind: 'image' | 'asset' }) {
  const { requestPick } = useAssetPicker()
  const [identifier, setIdentifier] = useState(() => referenceIdentifier(value))
  const [picked, setPicked] = useState<MediaAsset | null>(null)
  const [cropOpen, setCropOpen] = useState(false)

  // Stored identifiers are always local, so they resolve against 'neos'.
  const query = useAsset('neos', identifier)
  const asset = picked ?? query.data ?? null

  const cropConfig = useMemo(() => parseCropConfig(options), [options])

  // Cropping edits the original image, not a variant, so re-cropping never
  // compounds. When the current value is already a variant, resolve its
  // original; otherwise the current asset is itself the original.
  const originalIdentifier = asset?.originalAssetIdentifier ?? identifier
  const isVariant =
    originalIdentifier !== null && originalIdentifier !== identifier
  const originalQuery = useAsset('neos', originalIdentifier, isVariant)
  const originalAsset = isVariant ? (originalQuery.data ?? null) : asset
  const canCrop =
    kind === 'image' &&
    cropConfig.enabled &&
    asset !== null &&
    asset.assetType === 'Image'

  const applyCrop = (variant: MediaAsset) => {
    const id = variant.localAssetIdentifier ?? variant.identifier
    setPicked(variant)
    setIdentifier(id)
    onCommit(imageVariantReference(id))
  }

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
    const iconClass = kind === 'image' ? 'fa-image' : 'fa-paperclip'
    return (
      <button
        type="button"
        onClick={select}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-neutral-700 bg-neutral-950 px-3 py-4 text-sm text-neutral-400 hover:border-neutral-500 hover:text-white"
      >
        <i className={`fas ${iconClass} text-[1rem]`} aria-hidden />
        {kind === 'image'
          ? t('editor.selectImage', 'Select image…')
          : t('editor.selectAsset', 'Select asset…')}
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
              <i
                className="fas fa-spinner fa-spin text-[1.25rem] text-neutral-500"
                aria-hidden
              />
            ) : (
              <span className="py-6 text-xs text-neutral-500">
                {t('editor.assetNotFound', 'Asset not found')}
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
              {t('editor.select', 'Select…')}
            </span>
          </button>
          <div className="absolute top-1 right-1 z-10 flex gap-1">
            {canCrop && (
              <Button
                variant="secondary"
                size="icon-xs"
                onClick={() => setCropOpen(true)}
                title={t('editor.crop', 'Crop')}
              >
                <i className="fas fa-crop-simple" aria-hidden />
              </Button>
            )}
            <Button
              variant="secondary"
              size="icon-xs"
              onClick={clear}
              title={t('editor.remove', 'Remove')}
            >
              <i className="fas fa-xmark" aria-hidden />
            </Button>
          </div>
        </div>
        {asset && (
          <div
            className="mt-1 truncate text-xs text-neutral-400"
            title={asset.label}
          >
            {asset.label}
          </div>
        )}
        {canCrop && (
          <ImageCropDialog
            open={cropOpen}
            onOpenChange={setCropOpen}
            original={originalAsset}
            initialCrop={asset?.crop ?? null}
            config={cropConfig}
            onApply={applyCrop}
          />
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
          <i
            className="fas fa-spinner fa-spin text-[1rem] text-neutral-500"
            aria-hidden
          />
        ) : (
          <i
            className="fas fa-paperclip text-[1.25rem] text-neutral-600"
            aria-hidden
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm" title={asset?.label}>
          {asset
            ? asset.label
            : missing
              ? t('editor.assetNotFound', 'Asset not found')
              : t('editor.loading', 'Loading…')}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={select}>
        {t('editor.select', 'Select…')}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={clear}
        title={t('editor.remove', 'Remove')}
      >
        <i className="fas fa-xmark" aria-hidden />
      </Button>
    </div>
  )
}
