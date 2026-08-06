import { useEffect, useState } from 'react'

import {
  importProxyAsset,
  setAssetCollection,
  setAssetTag,
  updateAsset,
  useAsset,
  useAssetCollections,
  useTags,
  type MediaAsset,
} from '@/api/media'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { Labeled } from '@/features/inspector/PropertyEditor'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { removeAsset } from './AssetContextMenu'
import { AssetThumb } from './AssetThumb'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { formatBytes, formatDate } from './format'
import {
  collectionToNode,
  MediaTree,
  tagToNode,
  type MediaTreeNode,
} from './MediaTree'
import { ReplaceAssetDialog } from './ReplaceAssetDialog'
import { UsageTable } from './UsageTable'

interface AssetDetailsDialogProps {
  /** The asset selected in the list (list DTO; may lack the editable block for detail freshness). */
  asset: MediaAsset
  /** Called with `false` when the dialog should close. */
  onOpenChange: (open: boolean) => void
  /** Called after the asset is deleted (also closes the dialog). */
  onDeleted: () => void
}

/**
 * The asset metadata editing screen, shown as a modal dialog. Opened by
 * double-clicking an asset in the manage module. Reads the canonical detail so
 * the form, tags and collections are always fresh.
 */
export function AssetDetailsDialog({
  asset: listAsset,
  onOpenChange,
  onDeleted,
}: AssetDetailsDialogProps) {
  // Always read the canonical detail (fresh metadata, tags, collections).
  const detail = useAsset(listAsset.assetSource, listAsset.identifier)
  const asset = detail.data ?? listAsset
  const editable = !asset.isReadOnly && asset.localAssetIdentifier !== null
  const localId = asset.localAssetIdentifier

  // The parent mounts us only while an asset is selected, so drive `open` from
  // local state: flip it true on mount for the enter transition, and defer the
  // parent's unmount until `onOpenChangeComplete` so the exit transition plays.
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(true), [])

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(nextOpen) => !nextOpen && onOpenChange(false)}
    >
      <DialogContent size="lg" className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{asset.label}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Left: preview + read-only metadata. */}
          <div className="space-y-4 md:max-h-[70vh] md:overflow-y-auto md:pr-1">
            <div className="grid place-items-center overflow-hidden rounded-md bg-neutral-50 dark:bg-neutral-900 p-2">
              <AssetThumb asset={asset} preview />
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <Meta label={t('media.type', 'Type')}>{asset.assetType}</Meta>
              <Meta label={t('media.format', 'Format')}>{asset.mediaType}</Meta>
              <Meta label={t('media.size', 'Size')}>
                {formatBytes(asset.fileSize)}
              </Meta>
              {asset.width && asset.height ? (
                <Meta label={t('media.dimensions', 'Dimensions')}>
                  {asset.width} × {asset.height}
                </Meta>
              ) : null}
              <Meta label={t('media.modified', 'Modified')}>
                {formatDate(asset.lastModified)}
              </Meta>
              <Meta label={t('media.filename', 'Filename')}>
                {asset.filename}
              </Meta>
            </dl>
          </div>

          {/* Right: editable metadata, tags, collections and usage. */}
          <div className="space-y-4 md:max-h-[70vh] md:overflow-y-auto md:pr-1">
            {!asset.isImported && asset.isRemote && (
              <RemoteImport asset={asset} />
            )}

            {editable && localId ? (
              <MetadataForm key={localId} asset={asset} localId={localId} />
            ) : (
              !asset.isRemote && (
                <p className="text-xs text-neutral-500">
                  {t('media.readOnly', 'This asset is read-only.')}
                </p>
              )
            )}

            {editable && localId && (
              <>
                <TagAssignment localId={localId} assigned={asset.tags ?? []} />
                <CollectionAssignment
                  localId={localId}
                  assigned={asset.collections ?? []}
                />
              </>
            )}

            {localId && (
              <Field label={t('media.usage', 'Usage')}>
                <UsageTable
                  assetSource={asset.assetSource}
                  identifier={asset.identifier}
                />
              </Field>
            )}
          </div>
        </div>

        {editable && localId && (
          <DialogFooter>
            {/* Variants have no file of their own - the original carries it. */}
            {!asset.originalAssetIdentifier && (
              <ReplaceButton asset={asset} localId={localId} />
            )}
            <DeleteButton localId={localId} onDeleted={onDeleted} />
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function MetadataForm({
  asset,
  localId,
}: {
  asset: MediaAsset
  localId: string
}) {
  const [title, setTitle] = useState(asset.title ?? '')
  const [caption, setCaption] = useState(asset.caption ?? '')
  const [copyright, setCopyright] = useState(asset.copyrightNotice ?? '')
  const [saving, setSaving] = useState(false)

  const dirty =
    title !== (asset.title ?? '') ||
    caption !== (asset.caption ?? '') ||
    copyright !== (asset.copyrightNotice ?? '')

  async function save() {
    setSaving(true)
    try {
      await updateAsset(localId, { title, caption, copyrightNotice: copyright })
      toast.success(t('media.metadataSaved', 'Metadata saved.'))
    } catch (e) {
      toast.error(e, {
        title: t('media.metadataSaveFailed', 'Saving the metadata failed'),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    // Fields mirror the inspector's property layout (Labeled + plain
    // Input/Textarea) so metadata editing looks the same everywhere.
    <div className="space-y-4">
      <div>
        <Labeled label={t('media.title', 'Title')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Labeled>
      </div>
      <div>
        <Labeled label={t('media.caption', 'Caption')}>
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
        </Labeled>
      </div>
      <div>
        <Labeled label={t('media.copyright', 'Copyright')}>
          <Input
            value={copyright}
            onChange={(e) => setCopyright(e.target.value)}
          />
        </Labeled>
      </div>
      <Button size="sm" onClick={save} disabled={!dirty || saving}>
        {saving
          ? t('media.saving', 'Saving…')
          : t('media.saveMetadata', 'Save metadata')}
      </Button>
    </div>
  )
}

function TagAssignment({
  localId,
  assigned,
}: {
  localId: string
  assigned: { identifier: string; label: string }[]
}) {
  const tags = useTags()
  const assignedIds = new Set(assigned.map((t) => t.identifier))

  return (
    <Field label={t('media.tags', 'Tags')}>
      <div className="flex flex-wrap gap-1">
        {assigned.map((tag) => (
          <Chip
            key={tag.identifier}
            label={tag.label}
            onRemove={() =>
              void setAssetTag(localId, tag.identifier, false).catch((e) =>
                toast.error(e, {
                  title: t('media.tagRemoveFailed', 'Removing the tag failed'),
                }),
              )
            }
          />
        ))}
        {assigned.length === 0 && (
          <span className="text-xs text-neutral-500">
            {t('media.none', 'None')}
          </span>
        )}
      </div>
      <AssignTree
        placeholder={t('media.addTag', 'Add tag…')}
        treeLabel={t('media.tags', 'Tags')}
        emptyText={t('media.noTags', 'No tags yet')}
        emptyIcon="fa-tag"
        icon="fa-tag"
        loading={tags.isLoading}
        roots={(tags.data ?? []).map(tagToNode)}
        assignedIds={assignedIds}
        onToggle={(id, isAssigned) =>
          void setAssetTag(localId, id, !isAssigned).catch((e) =>
            toast.error(e, {
              title: isAssigned
                ? t('media.tagRemoveFailed', 'Removing the tag failed')
                : t('media.tagAddFailed', 'Adding the tag failed'),
            }),
          )
        }
      />
    </Field>
  )
}

function CollectionAssignment({
  localId,
  assigned,
}: {
  localId: string
  assigned: { identifier: string; title: string }[]
}) {
  const collections = useAssetCollections()
  const assignedIds = new Set(assigned.map((c) => c.identifier))

  return (
    <Field label={t('media.collections', 'Collections')}>
      <div className="flex flex-wrap gap-1">
        {assigned.map((collection) => (
          <Chip
            key={collection.identifier}
            label={collection.title}
            onRemove={() =>
              void setAssetCollection(
                localId,
                collection.identifier,
                false,
              ).catch((e) =>
                toast.error(e, {
                  title: t(
                    'media.collectionRemoveFailed',
                    'Removing from collection failed',
                  ),
                }),
              )
            }
          />
        ))}
        {assigned.length === 0 && (
          <span className="text-xs text-neutral-500">
            {t('media.none', 'None')}
          </span>
        )}
      </div>
      <AssignTree
        placeholder={t('media.addToCollection', 'Add to collection…')}
        treeLabel={t('media.collections', 'Collections')}
        emptyText={t('media.noCollections', 'No collections yet')}
        emptyIcon="fa-folder-open"
        icon="fa-folder"
        loading={collections.isLoading}
        roots={(collections.data ?? []).map(collectionToNode)}
        assignedIds={assignedIds}
        onToggle={(id, isAssigned) =>
          void setAssetCollection(localId, id, !isAssigned).catch((e) =>
            toast.error(e, {
              title: isAssigned
                ? t(
                    'media.collectionRemoveFailed',
                    'Removing from collection failed',
                  )
                : t('media.collectionAddFailed', 'Adding to collection failed'),
            }),
          )
        }
      />
    </Field>
  )
}

function RemoteImport({ asset }: { asset: MediaAsset }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="sm"
      className="w-full"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await importProxyAsset(asset.assetSource, asset.identifier)
          toast.success(t('media.assetImported', 'Asset imported to Neos.'))
        } catch (e) {
          toast.error(e, {
            title: t('media.importFailed', 'Importing the asset failed'),
          })
        } finally {
          setBusy(false)
        }
      }}
    >
      <i className="fas fa-download text-[1rem]" aria-hidden />
      {busy
        ? t('media.importing', 'Importing…')
        : t('media.importToNeos', 'Import to Neos')}
    </Button>
  )
}

function ReplaceButton({
  asset,
  localId,
}: {
  asset: MediaAsset
  localId: string
}) {
  const [replacing, setReplacing] = useState(false)

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setReplacing(true)}>
        <i className="fas fa-arrow-up-from-bracket text-[1rem]" aria-hidden />
        {t('media.replaceAsset', 'Replace file')}
      </Button>
      {replacing && (
        <ReplaceAssetDialog
          asset={asset}
          localId={localId}
          onOpenChange={(open) => !open && setReplacing(false)}
        />
      )}
    </>
  )
}

function DeleteButton({
  localId,
  onDeleted,
}: {
  localId: string
  onDeleted: () => void
}) {
  const [confirming, setConfirming] = useState(false)

  async function remove() {
    await removeAsset(localId)
    onDeleted()
  }

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setConfirming(true)}
      >
        <i className="fas fa-trash-can text-[1rem]" aria-hidden />
        {t('media.deleteAsset', 'Delete asset')}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={t('media.deleteAssetTitle', 'Delete this asset?')}
        description={t(
          'media.deleteAssetDescription',
          'The asset will be permanently removed. Assets that are still in use cannot be deleted.',
        )}
        onOpenChange={setConfirming}
        onConfirm={remove}
      />
    </>
  )
}

/**
 * The "add to…" dropdown for tags and collections: the same tree popover as
 * the media header's filter dropdowns. Clicking an unassigned entry assigns
 * it, clicking an assigned one (marked with a check) removes it again; the
 * popover stays open so several entries can be toggled in a row.
 */
function AssignTree({
  placeholder,
  treeLabel,
  emptyText,
  emptyIcon,
  icon,
  loading,
  roots,
  assignedIds,
  onToggle,
}: {
  placeholder: string
  treeLabel: string
  emptyText: string
  /** FontAwesome icon for the empty state. */
  emptyIcon: string
  /** FontAwesome icon for unassigned rows (tag / folder). */
  icon: string
  loading: boolean
  roots: MediaTreeNode[]
  assignedIds: Set<string>
  onToggle: (id: string, assigned: boolean) => void
}) {
  return (
    <Popover>
      <PopoverTrigger className="mt-1 flex h-7 w-full items-center gap-1.5 rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-300/30 dark:bg-neutral-700/30 px-2 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-300/50 dark:hover:bg-neutral-700/50">
        <span className="truncate">{placeholder}</span>
        <i
          className="fas fa-chevron-down ml-auto shrink-0 text-[0.75rem] text-neutral-950/50 dark:text-white/50"
          aria-hidden
        />
      </PopoverTrigger>
      <PopoverContent>
        <div className="min-w-56">
          <MediaTree
            label={treeLabel}
            emptyText={emptyText}
            emptyIcon={emptyIcon}
            loading={loading}
            roots={roots}
            selectedId={null}
            onSelect={(id) => onToggle(id, assignedIds.has(id))}
            icon={(node) =>
              assignedIds.has(node.id) ? (
                <i
                  className="fas fa-check text-[0.875rem] text-blue-500"
                  aria-hidden
                />
              ) : (
                <i className={cn('fas text-[0.875rem]', icon)} aria-hidden />
              )
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1 rounded bg-neutral-200 dark:bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-800 dark:text-neutral-200">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
        aria-label={t('media.removeLabel', 'Remove {0}', [label])}
      >
        <i className="fas fa-xmark text-[0.75rem]" aria-hidden />
      </button>
    </span>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className="mb-1 flex items-center gap-1.5 text-xs text-neutral-950 dark:text-white">
        {label}
      </h3>
      {children}
    </div>
  )
}

function Meta({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <>
      <dt className="text-neutral-500">{label}</dt>
      <dd
        className={cn(
          'truncate text-right text-neutral-700 dark:text-neutral-300',
        )}
      >
        {children}
      </dd>
    </>
  )
}
