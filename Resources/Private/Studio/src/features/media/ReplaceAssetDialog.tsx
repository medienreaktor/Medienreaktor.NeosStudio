import { useState } from 'react'
import { useDropzone, type Accept } from 'react-dropzone'

import {
  replaceAssetResource,
  useAssetUsages,
} from '@/api/neos/endpoints/assets'
import type { Asset } from '@/api/neos/schema'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { translate as t, translatePlural as tp } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { AssetThumb } from './AssetThumb'
import { formatBytes } from './format'

/**
 * Which files the picker offers. The server refuses replacing an image, audio
 * or video asset with a different media type family, so the file dialog is
 * pre-filtered to the ones that can succeed. Documents accept anything, like
 * the classic Media Browser.
 */
const acceptByAssetType: Partial<Record<Asset['assetType'], Accept>> = {
  image: { 'image/*': [] },
  video: { 'video/*': [] },
  audio: { 'audio/*': [] },
}

interface ReplaceAssetDialogProps {
  /** The asset whose file is being swapped (a local, writable one). */
  asset: Asset
  /** The asset's local identifier - the write address. */
  localId: string
  /** Called with `false` when the dialog should close. */
  onOpenChange: (open: boolean) => void
  /** Called after the file was replaced, with the updated asset. */
  onReplaced?: (asset: Asset) => void
}

/**
 * Swaps the file behind an asset while keeping its identity: title, tags,
 * collections and every node referencing it stay put and start rendering the
 * new file. Reached from the asset details dialog and the asset context menu.
 */
export function ReplaceAssetDialog({
  asset,
  localId,
  onOpenChange,
  onReplaced,
}: ReplaceAssetDialogProps) {
  // Mirrors AssetDetailsDialog: the parent mounts us only while a target
  // exists, so drive `open` locally - open from the start - and defer the
  // unmount to `onOpenChangeComplete` so the exit transition plays.
  const [open, setOpen] = useState(true)

  const [file, setFile] = useState<File | null>(null)
  const [keepOriginalFilename, setKeepOriginalFilename] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const busy = progress !== null

  const usage = useAssetUsages(asset.assetSourceId, asset.id)
  const usageTotal =
    (usage.data?.meta.total ?? 0) + (usage.data?.meta.inaccessible ?? 0)

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    open: browse,
  } = useDropzone({
    onDrop: (files) => files[0] && setFile(files[0]),
    accept: acceptByAssetType[asset.assetType],
    multiple: false,
    noClick: true,
    disabled: busy,
  })

  async function replace() {
    if (!file) return
    setProgress(0)
    try {
      const updated = await replaceAssetResource(localId, file, {
        keepOriginalFilename,
        onProgress: setProgress,
      })
      toast.success(
        t('media.assetReplaced', 'The file of "{0}" was replaced.', [
          updated.label,
        ]),
      )
      onReplaced?.(updated)
      setOpen(false)
    } catch (e) {
      toast.error(e, {
        title: t('media.replaceAssetFailed', 'Replacing the file failed'),
      })
    } finally {
      setProgress(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next)
      }}
      onOpenChangeComplete={(nextOpen) => !nextOpen && onOpenChange(false)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('media.replaceAsset', 'Replace file')}</DialogTitle>
          <DialogDescription>
            {t(
              'media.replaceAssetDescription',
              'The new file takes the place of the current one. Title, tags, collections and every reference to this asset are kept.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          {/* The file being replaced, so it is clear what is about to change. */}
          <div className="flex items-center gap-3 rounded-md bg-card p-2">
            <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded bg-muted">
              <AssetThumb asset={asset} className="type-heading-l" />
            </div>
            <div className="min-w-0 type-small">
              <p className="truncate text-foreground">{asset.filename}</p>
              <p className="text-muted-foreground">
                {formatBytes(asset.fileSize)} · {asset.mediaType}
              </p>
            </div>
          </div>

          <div
            {...getRootProps()}
            className={cn(
              'grid place-items-center rounded-md border-2 border-dashed p-5.5 text-center transition-colors',
              isDragActive ? 'border-primary bg-primary-tint' : 'border-border',
            )}
          >
            <input {...getInputProps()} />
            {file ? (
              <>
                <i
                  className="fas fa-file-circle-check mb-2 type-icon-3xl text-primary-text"
                  aria-hidden
                />
                <p className="max-w-full truncate type-body text-foreground">
                  {file.name}
                </p>
                <p className="mb-3 type-small text-muted-foreground">
                  {formatBytes(file.size)}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={browse}
                >
                  {t('media.chooseAnotherFile', 'Choose another file')}
                </Button>
              </>
            ) : (
              <>
                <i
                  className="fas fa-cloud-arrow-up mb-2 type-icon-3xl text-muted-foreground"
                  aria-hidden
                />
                <p className="type-body text-muted-foreground">
                  {t('media.dragFileHere', 'Drag the new file here')}
                </p>
                <p className="mb-3 type-small text-muted-foreground">
                  {t('media.or', 'or')}
                </p>
                <Button variant="outline" size="sm" onClick={browse}>
                  {t('media.chooseFile', 'Choose file')}
                </Button>
              </>
            )}
          </div>

          {progress !== null && (
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-2 type-small text-muted-foreground">
            <Checkbox
              checked={keepOriginalFilename}
              onCheckedChange={setKeepOriginalFilename}
              disabled={busy}
            />
            <span className="min-w-0 truncate">
              {t('media.keepOriginalFilename', 'Keep the filename "{0}"', [
                asset.filename,
              ])}
            </span>
          </label>

          {usageTotal > 0 && (
            <p className="flex items-start gap-2 rounded-md bg-card p-2 type-small text-muted-foreground">
              <i
                className="fas fa-circle-info mt-0.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span>
                {tp('media.replaceAssetUsageNote', usageTotal, [
                  'This asset is used {0} time. That usage will show the new file.',
                  'This asset is used {0} times. All usages will show the new file.',
                ])}
              </span>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button disabled={!file || busy} onClick={replace}>
            {busy
              ? t('media.replacing', 'Replacing…')
              : t('media.replaceAsset', 'Replace file')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
