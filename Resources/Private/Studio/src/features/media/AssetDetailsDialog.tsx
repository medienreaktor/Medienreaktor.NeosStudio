import { useState } from 'react'
import { DownloadIcon, Trash2Icon, XIcon } from 'lucide-react'

import { ApiError } from '@/api/client'
import {
  deleteAsset,
  importProxyAsset,
  setAssetCollection,
  setAssetTag,
  updateAsset,
  useAsset,
  useAssetCollections,
  useTags,
  type MediaAsset,
  type MediaTag,
} from '@/api/media'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { AssetThumb } from './AssetThumb'
import { ConfirmDialog } from './ConfirmDialog'
import { formatBytes, formatDate } from './format'
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

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{asset.label}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid place-items-center overflow-hidden rounded-md bg-neutral-900 p-2">
            <AssetThumb asset={asset} preview />
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <Meta label="Type">{asset.assetType}</Meta>
            <Meta label="Format">{asset.mediaType}</Meta>
            <Meta label="Size">{formatBytes(asset.fileSize)}</Meta>
            {asset.width && asset.height ? (
              <Meta label="Dimensions">
                {asset.width} × {asset.height}
              </Meta>
            ) : null}
            <Meta label="Modified">{formatDate(asset.lastModified)}</Meta>
            <Meta label="Filename">{asset.filename}</Meta>
          </dl>

          {!asset.isImported && asset.isRemote && (
            <RemoteImport asset={asset} />
          )}

          {editable && localId ? (
            <MetadataForm key={localId} asset={asset} localId={localId} />
          ) : (
            !asset.isRemote && (
              <p className="text-xs text-neutral-500">
                This asset is read-only.
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
            <Field label="Usage">
              <UsageTable
                assetSource={asset.assetSource}
                identifier={asset.identifier}
              />
            </Field>
          )}
        </div>

        {editable && localId && (
          <DialogFooter>
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
  const [saved, setSaved] = useState(false)

  const dirty =
    title !== (asset.title ?? '') ||
    caption !== (asset.caption ?? '') ||
    copyright !== (asset.copyrightNotice ?? '')

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      await updateAsset(localId, { title, caption, copyrightNotice: copyright })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <Field label="Title">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-8"
        />
      </Field>
      <Field label="Caption">
        <Textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={2}
        />
      </Field>
      <Field label="Copyright">
        <Input
          value={copyright}
          onChange={(e) => setCopyright(e.target.value)}
          className="h-8"
        />
      </Field>
      <Button size="sm" onClick={save} disabled={!dirty || saving}>
        {saving ? 'Saving…' : saved && !dirty ? 'Saved' : 'Save metadata'}
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
  const flat = flattenTags(tags.data ?? [])
  const available = flat.filter((t) => !assignedIds.has(t.identifier))

  return (
    <Field label="Tags">
      <div className="flex flex-wrap gap-1">
        {assigned.map((tag) => (
          <Chip
            key={tag.identifier}
            label={tag.label}
            onRemove={() => void setAssetTag(localId, tag.identifier, false)}
          />
        ))}
        {assigned.length === 0 && (
          <span className="text-xs text-neutral-500">None</span>
        )}
      </div>
      {available.length > 0 && (
        <AddSelect
          placeholder="Add tag…"
          options={available.map((t) => ({
            value: t.identifier,
            label: t.label,
          }))}
          onAdd={(id) => void setAssetTag(localId, id, true)}
        />
      )}
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
  const available = (collections.data ?? []).filter(
    (c) => !assignedIds.has(c.identifier),
  )

  return (
    <Field label="Collections">
      <div className="flex flex-wrap gap-1">
        {assigned.map((collection) => (
          <Chip
            key={collection.identifier}
            label={collection.title}
            onRemove={() =>
              void setAssetCollection(localId, collection.identifier, false)
            }
          />
        ))}
        {assigned.length === 0 && (
          <span className="text-xs text-neutral-500">None</span>
        )}
      </div>
      {available.length > 0 && (
        <AddSelect
          placeholder="Add to collection…"
          options={available.map((c) => ({
            value: c.identifier,
            label: c.title,
          }))}
          onAdd={(id) => void setAssetCollection(localId, id, true)}
        />
      )}
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
        } finally {
          setBusy(false)
        }
      }}
    >
      <DownloadIcon className="size-4" />
      {busy ? 'Importing…' : 'Import to Neos'}
    </Button>
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
    try {
      await deleteAsset(localId)
    } catch (e) {
      // Surface the server's in-use guard as a readable message in the dialog.
      if (
        e instanceof ApiError &&
        (e.body as { error?: string } | null)?.error === 'asset_in_use'
      ) {
        throw new Error('This asset is in use and cannot be deleted.')
      }
      throw new Error('Deleting the asset failed.')
    }
    onDeleted()
  }

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setConfirming(true)}
      >
        <Trash2Icon className="size-4" />
        Delete asset
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Delete this asset?"
        description="The asset will be permanently removed. Assets that are still in use cannot be deleted."
        onOpenChange={setConfirming}
        onConfirm={remove}
      />
    </>
  )
}

function AddSelect({
  placeholder,
  options,
  onAdd,
}: {
  placeholder: string
  options: { value: string; label: string }[]
  onAdd: (value: string) => void
}) {
  return (
    <Select value="" onValueChange={(v) => onAdd(v as string)} items={options}>
      <SelectTrigger size="sm" className="mt-1 h-7 w-full text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="text-neutral-500 hover:text-neutral-200"
        aria-label={`Remove ${label}`}
      >
        <XIcon className="size-3" />
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
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
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
      <dd className={cn('truncate text-right text-neutral-300')}>{children}</dd>
    </>
  )
}

function flattenTags(tags: MediaTag[]): MediaTag[] {
  const out: MediaTag[] = []
  const walk = (list: MediaTag[]) => {
    for (const tag of list) {
      out.push(tag)
      walk(tag.children)
    }
  }
  walk(tags)
  return out
}
