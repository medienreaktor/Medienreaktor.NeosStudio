import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'

import { uploadAsset } from '@/api/media'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface UploadItem {
  id: string
  name: string
  progress: number
  status: 'uploading' | 'done' | 'error'
}

interface MediaUploaderProps {
  /** Assets are uploaded into this collection when set (the active sidebar filter). */
  collection: string | null
  /** Tagged with this tag when a single tag is the active filter. */
  tag: string | null
  onClose: () => void
}

let uploadCounter = 0

/** Drag-and-drop / click uploader with per-file progress bars. */
export function MediaUploader({
  collection,
  tag,
  onClose,
}: MediaUploaderProps) {
  const [items, setItems] = useState<UploadItem[]>([])

  const onDrop = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const id = `upload-${uploadCounter++}`
        setItems((current) => [
          ...current,
          { id, name: file.name, progress: 0, status: 'uploading' },
        ])
        void uploadAsset(file, {
          collection,
          tags: tag ? [tag] : [],
          onProgress: (fraction) =>
            setItems((current) =>
              current.map((item) =>
                item.id === id ? { ...item, progress: fraction } : item,
              ),
            ),
        })
          .then(() =>
            setItems((current) =>
              current.map((item) =>
                item.id === id
                  ? { ...item, progress: 1, status: 'done' }
                  : item,
              ),
            ),
          )
          .catch((e: unknown) => {
            setItems((current) =>
              current.map((item) =>
                item.id === id ? { ...item, status: 'error' } : item,
              ),
            )
            toast.error(e, {
              title: t('media.uploadFileFailed', 'Uploading "{0}" failed', [
                file.name,
              ]),
            })
          })
      }
    },
    [collection, tag],
  )

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    noClick: true,
  })

  const allDone =
    items.length > 0 && items.every((item) => item.status !== 'uploading')

  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-white/80 dark:bg-neutral-950/80 p-8">
      <div className="w-full max-w-md rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-4 py-3">
          <h2 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            {t('media.uploadAssets', 'Upload assets')}
          </h2>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label={t('media.closeUploader', 'Close uploader')}
          >
            <i className="fas fa-xmark text-[1rem]" aria-hidden />
          </Button>
        </div>

        <div className="p-4">
          <div
            {...getRootProps()}
            className={cn(
              'grid place-items-center rounded-md border-2 border-dashed p-8 text-center transition-colors',
              isDragActive
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-neutral-300 dark:border-neutral-700',
            )}
          >
            <input {...getInputProps()} />
            <i
              className="fas fa-cloud-arrow-up mb-2 text-[2rem] text-neutral-500"
              aria-hidden
            />
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              {t('media.dragFilesHere', 'Drag files here')}
            </p>
            <p className="mb-3 text-xs text-neutral-500">
              {t('media.or', 'or')}
            </p>
            <Button variant="outline" size="sm" onClick={open}>
              {t('media.chooseFiles', 'Choose files')}
            </Button>
          </div>

          {items.length > 0 && (
            <ul className="mt-4 max-h-48 space-y-2 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id} className="text-xs">
                  <div className="mb-1 flex justify-between">
                    <span className="truncate text-neutral-700 dark:text-neutral-300">
                      {item.name}
                    </span>
                    <span
                      className={cn(
                        'shrink-0',
                        item.status === 'error'
                          ? 'text-red-500'
                          : 'text-neutral-500',
                      )}
                    >
                      {item.status === 'error'
                        ? t('media.failed', 'Failed')
                        : item.status === 'done'
                          ? t('media.done', 'Done')
                          : `${Math.round(item.progress * 100)}%`}
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                    <div
                      className={cn(
                        'h-full transition-[width]',
                        item.status === 'error' ? 'bg-red-500' : 'bg-blue-500',
                      )}
                      style={{ width: `${item.progress * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {allDone && (
          <div className="border-t border-neutral-200 dark:border-neutral-800 px-4 py-3 text-right">
            <Button size="sm" onClick={onClose}>
              {t('media.done', 'Done')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
