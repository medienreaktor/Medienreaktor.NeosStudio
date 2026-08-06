import { useEffect, useState } from 'react'
import { useDropzone, type Accept } from 'react-dropzone'

import {
  replaceAssetResource,
  useAssetUsage,
  type MediaAsset,
} from '@/api/media'
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
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { AssetThumb } from './AssetThumb'
import { formatBytes } from './format'

/**
 * Which files the picker offers. The server refuses replacing an image, audio
 * or video asset with a different media type family, so the file dialog is
 * pre-filtered to the ones that can succeed. Documents accept anything, like
 * the classic Media Browser.
 */
const acceptByAssetType: Partial<Record<MediaAsset['assetType'], Accept>> = {
  Image: { 'image/*': [] },
  Video: { 'video/*': [] },
  Audio: { 'audio/*': [] },
}

interface ReplaceAssetDialogProps {
  /** The asset whose file is being swapped (a local, writable one). */
  asset: MediaAsset
  /** The asset's local identifier - the write address. */
  localId: string
  /** Called with `false` when the dialog should close. */
  onOpenChange: (open: boolean) => void
  /** Called after the file was replaced, with the updated asset. */
  onReplaced?: (asset: MediaAsset) => void
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
  // exists, so drive `open` locally for the enter transition and defer the
  // unmount to `onOpenChangeComplete` so the exit transition plays.
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(true), [])

  const [file, setFile] = useState<File | null>(null)
  const [keepOriginalFilename, setKeepOriginalFilename] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const busy = progress !== null

  const usage = useAssetUsage(asset.assetSource, asset.identifier)
  const usageTotal = usage.data?.total ?? 0

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

        <div className="space-y-4">
          {/* The file being replaced, so it is clear what is about to change. */}
          <div className="flex items-center gap-3 rounded-md bg-neutral-50 dark:bg-neutral-900 p-2">
            <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
              <AssetThumb asset={asset} className="text-[1.5rem]" />
            </div>
            <div className="min-w-0 text-xs">
              <p className="truncate text-neutral-800 dark:text-neutral-200">
                {asset.filename}
              </p>
              <p className="text-neutral-500">
                {formatBytes(asset.fileSize)} · {asset.mediaType}
              </p>
            </div>
          </div>

          <div
            {...getRootProps()}
            className={cn(
              'grid place-items-center rounded-md border-2 border-dashed p-6 text-center transition-colors',
              isDragActive
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-neutral-300 dark:border-neutral-700',
            )}
          >
            <input {...getInputProps()} />
            {file ? (
              <>
                <i
                  className="fas fa-file-circle-check mb-2 text-[1.5rem] text-blue-500"
                  aria-hidden
                />
                <p className="max-w-full truncate text-sm text-neutral-800 dark:text-neutral-200">
                  {file.name}
                </p>
                <p className="mb-3 text-xs text-neutral-500">
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
                  className="fas fa-cloud-arrow-up mb-2 text-[1.5rem] text-neutral-500"
                  aria-hidden
                />
                <p className="text-sm text-neutral-700 dark:text-neutral-300">
                  {t('media.dragFileHere', 'Drag the new file here')}
                </p>
                <p className="mb-3 text-xs text-neutral-500">
                  {t('media.or', 'or')}
                </p>
                <Button variant="outline" size="sm" onClick={browse}>
                  {t('media.chooseFile', 'Choose file')}
                </Button>
              </>
            )}
          </div>

          {progress !== null && (
            <div className="h-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div
                className="h-full bg-blue-500 transition-[width]"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300">
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
            <p className="flex items-start gap-2 rounded-md bg-neutral-50 dark:bg-neutral-900 p-2 text-xs text-neutral-600 dark:text-neutral-400">
              <i
                className="fas fa-circle-info mt-0.5 shrink-0 text-neutral-500"
                aria-hidden
              />
              <span>
                {t(
                  'media.replaceAssetUsageNote',
                  'This asset is used {0} time(s). All usages will show the new file.',
                  [usageTotal],
                )}
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
