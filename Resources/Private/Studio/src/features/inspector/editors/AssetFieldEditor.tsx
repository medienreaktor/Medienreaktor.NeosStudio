import { useMemo, useState } from 'react'

import {
  assetReference,
  localAssetIdFor,
  referenceIdentifier,
  useAsset,
} from '@/api/neos/endpoints/assets'
import type { Asset } from '@/api/neos/schema'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { useAssetPicker } from '@/features/media/AssetPicker'
import { AssetThumb } from '@/features/media/AssetThumb'
import type { PropertyEditorProps } from './registry'
import { parseCropConfig } from './cropOptions'
import { ImageCropDialog } from './ImageCropDialog'
import { translate as t } from '@/lib/i18n'

/**
 * The shared body of the Asset and Image editors: shows the currently
 * referenced asset (thumbnail/preview + label) and hands off to the Media
 * Library in picker mode to choose another. `kind` only changes the look -
 * "image" shows a large preview (and offers cropping), "asset" a compact row;
 * both commit the picked asset's id.
 *
 * A stored value is only ever an identifier (see referenceIdentifier in api/neos/endpoints/assets.ts), so the asset
 * to display is resolved from the API. A fresh pick is held locally too, so the
 * preview updates instantly, ahead of the resolve. State is seeded from
 * `value` and owned here between value changes - the inspector remounts the
 * editor (keyed by node + property) when the edited subject changes, and the
 * sync below adopts a `value` that changed underneath (the node refetch after
 * a pick through the preview's image overlay, a collaborator's edit), which
 * this editor would otherwise never learn about.
 */
export function AssetFieldEditor({
  id,
  subject,
  value,
  onCommit,
  options,
  kind,
}: PropertyEditorProps & { kind: 'image' | 'asset' }) {
  const { requestPick } = useAssetPicker()
  const [identifier, setIdentifier] = useState(() => referenceIdentifier(value))
  const [picked, setPicked] = useState<Asset | null>(null)
  const [cropOpen, setCropOpen] = useState(false)

  // Adopt external value changes: when the refetched node carries a different
  // identifier than the one this editor last saw AND holds, someone else set
  // the property (preview overlay pick, collaborator) - re-seed from it. The
  // editor's own pick is not "external": by the time the refetch lands, the
  // held identifier already matches, so the instant local preview survives.
  const valueIdentifier = referenceIdentifier(value)
  const [seenValueIdentifier, setSeenValueIdentifier] =
    useState(valueIdentifier)
  if (valueIdentifier !== seenValueIdentifier) {
    setSeenValueIdentifier(valueIdentifier)
    if (valueIdentifier !== identifier) {
      setIdentifier(valueIdentifier)
      setPicked(null)
    }
  }

  // Stored identifiers are always local, so they resolve against 'neos'.
  const query = useAsset('neos', identifier)
  const asset = picked ?? query.data ?? null

  const cropConfig = useMemo(() => parseCropConfig(options), [options])

  // Cropping edits the original image, not a variant, so re-cropping never
  // compounds. When the current value is already a variant, resolve its
  // original; otherwise the current asset is itself the original.
  const originalIdentifier = asset?.originalAssetId ?? identifier
  const isVariant =
    originalIdentifier !== null && originalIdentifier !== identifier
  const originalQuery = useAsset('neos', originalIdentifier, isVariant)
  const originalAsset = isVariant ? (originalQuery.data ?? null) : asset
  const canCrop =
    kind === 'image' &&
    cropConfig.enabled &&
    asset !== null &&
    asset.assetType === 'image'

  const applyCrop = (variant: Asset) => {
    const id = variant.localAssetId ?? variant.id
    setPicked(variant)
    setIdentifier(id)
    onCommit(assetReference(id))
  }

  const select = () => {
    requestPick({
      title: subject.label,
      onPick: (chosen) => {
        localAssetIdFor(chosen)
          .then((id) => {
            setPicked(chosen)
            setIdentifier(id)
            onCommit(assetReference(id))
          })
          .catch((e: unknown) =>
            toast.error(e, {
              title: t('editor.pickAssetFailed', 'Picking asset failed'),
            }),
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
        id={id}
        type="button"
        onClick={select}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background px-3 py-3.5 type-body text-muted-foreground hover:border-placeholder hover:text-foreground"
      >
        <i className={`fas ${iconClass} type-icon-xl`} aria-hidden />
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
        <div className="group relative overflow-hidden rounded-md border border-border bg-background">
          <div className="flex min-h-22.5 items-center justify-center p-2">
            {asset ? (
              <AssetThumb asset={asset} preview className="max-h-45" />
            ) : loading ? (
              <i
                className="fas fa-spinner fa-spin type-icon-2xl text-muted-foreground"
                aria-hidden
              />
            ) : (
              <span className="py-5.5 type-small text-muted-foreground">
                {t('editor.assetNotFound', 'Asset not found')}
              </span>
            )}
          </div>
          {/* Covers the preview: invisible until hover, but clickable throughout
              so a click anywhere on the preview reselects. */}
          <button
            id={id}
            type="button"
            onClick={select}
            className="absolute inset-0 flex items-center justify-center bg-scrim/60 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <span className="rounded-md bg-primary px-3 py-1.5 type-body-strong text-primary-foreground">
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
            className="mt-1 truncate type-small text-muted-foreground"
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
    <div className="flex items-center gap-3 rounded-md border border-border bg-background p-2">
      <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded bg-card">
        {asset ? (
          <AssetThumb asset={asset} />
        ) : loading ? (
          <i
            className="fas fa-spinner fa-spin type-icon-xl text-muted-foreground"
            aria-hidden
          />
        ) : (
          <i
            className="fas fa-paperclip type-icon-2xl text-placeholder"
            aria-hidden
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate type-body" title={asset?.label}>
          {asset
            ? asset.label
            : missing
              ? t('editor.assetNotFound', 'Asset not found')
              : t('editor.loading', 'Loading…')}
        </div>
      </div>
      <Button id={id} variant="outline" size="sm" onClick={select}>
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
