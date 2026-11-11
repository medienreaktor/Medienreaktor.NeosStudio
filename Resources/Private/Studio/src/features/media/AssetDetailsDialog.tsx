import { useEffect, useState } from 'react'

import {
  createAssetTag,
  importAsset,
  isImportedAsset,
  isRemoteAsset,
  setAssetCollection,
  setAssetTag,
  updateAsset,
  useAsset,
  useAssetCollections,
  useAssetTags,
} from '@/api/neos/endpoints/assets'
import type { Asset, AssetTag } from '@/api/neos/schema'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DraftField, isApplyChord } from '@/components/ui/draft-field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  ReferencePicker,
  SelectedItemRow,
  treePickerOptions,
  type PickerTreeNode,
} from '@/features/inspector/editors/ReferencePicker'
import { UnsavedChangesPrompt } from '@/features/inspector/unsavedChanges'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { removeAsset } from './AssetContextMenu'
import { AssetThumb } from './AssetThumb'
import {
  assetTypeLabel,
  formatBytes,
  formatDate,
  formatDateTime,
  formatLabel,
  splitFilename,
} from './format'
import { ReplaceAssetDialog } from './ReplaceAssetDialog'
import { UsageTable } from './UsageTable'

interface AssetDetailsDialogProps {
  /** The asset selected in the list - shown until its detail is read. */
  asset: Asset
  /** Called with `false` when the dialog should close. */
  onOpenChange: (open: boolean) => void
  /** Called after the asset is deleted (also closes the dialog). */
  onDeleted: () => void
}

/**
 * The asset metadata editing screen, shown as a modal dialog. Opened by
 * double-clicking an asset in the manage module. Reads the canonical detail so
 * the form, tags and collections are always fresh.
 *
 * The metadata text fields save explicitly, like the inspector: one at a time
 * on Enter / mod+Enter or their inline apply button, or all together with
 * the footer's "Save and close", which replaces "Done" while anything is
 * unsaved (next to Revert). A failed save keeps the dialog open. Closing
 * otherwise with unsaved fields asks first. Tags and collections save
 * as they are picked or removed.
 */
export function AssetDetailsDialog({
  asset: listAsset,
  onOpenChange,
  onDeleted,
}: AssetDetailsDialogProps) {
  // Always read the canonical detail (fresh metadata, tags, collections).
  const detail = useAsset(listAsset.assetSourceId, listAsset.id)
  const asset = detail.data ?? listAsset
  const editable = !asset.isReadOnly && asset.localAssetId !== null
  const localId = asset.localAssetId
  const form = useMetadataForm(asset, editable ? localId : null)
  const unsaved = form.dirtyKeys.length > 0

  // The parent mounts us only while an asset is selected, so drive `open` from
  // local state: open from the start (the dialog plays its enter transition on
  // mount), and defer the parent's unmount until `onOpenChangeComplete` so the
  // exit transition plays.
  const [open, setOpen] = useState(true)
  // Closing with unsaved fields asks first (Escape, the X, the backdrop).
  const [confirmClose, setConfirmClose] = useState(false)
  const [savingAll, setSavingAll] = useState(false)
  const requestClose = () => (unsaved ? setConfirmClose(true) : setOpen(false))

  const saveAll = async () => {
    setSavingAll(true)
    try {
      return await form.save()
    } finally {
      setSavingAll(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : requestClose())}
      onOpenChangeComplete={(nextOpen) => !nextOpen && onOpenChange(false)}
    >
      <DialogContent size="lg" className="max-w-210">
        <DialogHeader>
          <DialogTitle className="truncate pr-5.5">{asset.label}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-5.5 md:grid-cols-2">
          {/* Left: preview + read-only file facts. */}
          <div className="space-y-3.5 md:max-h-[70vh] md:overflow-y-auto md:pr-1">
            <div className="grid place-items-center overflow-hidden rounded-md bg-card p-2">
              <AssetThumb asset={asset} preview />
            </div>
            <FileFacts asset={asset} />
          </div>

          {/* Right: editable metadata, tags, collections and usage. */}
          <div className="space-y-3.5 md:max-h-[70vh] md:overflow-y-auto md:pr-1">
            {!isImportedAsset(asset) && isRemoteAsset(asset) && (
              <RemoteImport asset={asset} />
            )}

            {editable && localId ? (
              <>
                {METADATA_FIELDS.map((field) => (
                  <MetadataField
                    key={field.key}
                    label={field.label()}
                    multiline={field.multiline}
                    value={form.drafts[field.key]}
                    dirty={form.isDirty(field.key)}
                    status={form.status[field.key] ?? 'idle'}
                    onChange={(value) => form.setDraft(field.key, value)}
                    onApply={() => void form.save([field.key])}
                    onRevert={() => form.revert([field.key])}
                  />
                ))}
                <TagAssignment localId={localId} assigned={asset.tags ?? []} />
                <CollectionAssignment
                  localId={localId}
                  assigned={asset.collections ?? []}
                />
              </>
            ) : (
              !isRemoteAsset(asset) && (
                <p className="type-small text-muted-foreground">
                  {t('media.readOnly', 'This asset is read-only.')}
                </p>
              )
            )}

            {localId && (
              <Field label={t('media.usage', 'Usage')}>
                <UsageTable
                  assetSourceId={asset.assetSourceId}
                  assetId={asset.id}
                />
              </Field>
            )}
          </div>
        </div>

        {/* Destructive / file actions on the left, the closing action where
            the eye ends: bottom right - Revert + "Save and close" while
            fields are unsaved, Done otherwise. */}
        <DialogFooter className="sm:justify-between">
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {editable && localId && (
              <>
                {/* Variants have no file of their own - the original carries it. */}
                {!asset.originalAssetId && (
                  <ReplaceButton asset={asset} localId={localId} />
                )}
                <DeleteButton localId={localId} onDeleted={onDeleted} />
              </>
            )}
          </div>
          {unsaved ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                variant="secondary"
                size="sm"
                disabled={savingAll}
                onClick={() => form.revert()}
              >
                {t('media.revertChanges', 'Revert')}
              </Button>
              <Button
                size="sm"
                disabled={savingAll}
                onClick={async () => {
                  if (await saveAll()) setOpen(false)
                }}
              >
                {savingAll
                  ? t('media.saving', 'Saving…')
                  : t('media.saveAndClose', 'Save and close')}
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setOpen(false)}>
              {t('media.done', 'Done')}
            </Button>
          )}
        </DialogFooter>

        <UnsavedChangesPrompt
          open={confirmClose}
          labels={METADATA_FIELDS.filter((field) =>
            form.dirtyKeys.includes(field.key),
          ).map((field) => field.label())}
          saveLabel={t('media.saveAndClose', 'Save and close')}
          busy={savingAll}
          onSave={async () => {
            if (!(await saveAll())) return
            setConfirmClose(false)
            setOpen(false)
          }}
          onDiscard={() => {
            form.revert()
            setConfirmClose(false)
            setOpen(false)
          }}
          onStay={() => setConfirmClose(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

/** The read-only file facts, as a compact label / value list. */
function FileFacts({ asset }: { asset: Asset }) {
  const { stem, extension } = splitFilename(asset.filename)
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 type-small text-muted-foreground">
      <Fact label={t('media.type', 'Type')}>
        {assetTypeLabel(asset.assetType)}
      </Fact>
      <Fact label={t('media.format', 'Format')}>
        <span title={asset.mediaType}>
          {formatLabel(asset.filename, asset.mediaType)}
        </span>
      </Fact>
      <Fact label={t('media.size', 'Size')}>{formatBytes(asset.fileSize)}</Fact>
      {asset.width && asset.height ? (
        <Fact label={t('media.dimensions', 'Dimensions')}>
          {asset.width} × {asset.height}
        </Fact>
      ) : null}
      <Fact label={t('media.modified', 'Modified')}>
        <span title={formatDateTime(asset.lastModified)}>
          {formatDate(asset.lastModified)}
        </span>
      </Fact>
      <Fact label={t('media.filename', 'Filename')}>
        {/* The stem truncates, the extension stays visible. */}
        <span className="flex min-w-0 justify-end" title={asset.filename}>
          <span className="truncate">{stem}</span>
          <span className="shrink-0">{extension}</span>
        </span>
      </Fact>
    </dl>
  )
}

function Fact({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </>
  )
}

type SaveStatus = 'idle' | 'saving' | 'saved'

type MetadataKey = 'title' | 'caption' | 'copyrightNotice'
type MetadataValues = Record<MetadataKey, string>

const METADATA_FIELDS: {
  key: MetadataKey
  label: () => string
  multiline: boolean
}[] = [
  { key: 'title', label: () => t('media.title', 'Title'), multiline: false },
  {
    key: 'caption',
    label: () => t('media.caption', 'Caption'),
    multiline: true,
  },
  {
    key: 'copyrightNotice',
    label: () => t('media.copyright', 'Copyright'),
    multiline: false,
  },
]
const METADATA_KEYS = METADATA_FIELDS.map((field) => field.key)

function savedMetadata(asset: Asset): MetadataValues {
  return {
    title: asset.title ?? '',
    caption: asset.caption ?? '',
    copyrightNotice: asset.copyrightNotice ?? '',
  }
}

function pick(values: MetadataValues, keys: MetadataKey[]) {
  return Object.fromEntries(
    keys.map((key) => [key, values[key]]),
  ) as Partial<MetadataValues>
}

/**
 * The metadata form's state: one draft per field, saved per field (inline
 * apply) or together (the footer's Save, one request). Works like the
 * inspector's text editors (see textEditorBody): a field's draft follows the
 * saved value while it has no unsaved edit; a draft handed to a save counts
 * as clean right away (the saved asset comes back a moment later); a failed
 * save keeps the drafts so the user can try again. Each field's status
 * ("Saving…", then "Saved" for a moment) shows beside its label.
 */
function useMetadataForm(asset: Asset, localId: string | null) {
  const saved = savedMetadata(asset)
  const [drafts, setDrafts] = useState(saved)
  const [bases, setBases] = useState(saved)
  const follow = METADATA_KEYS.filter(
    (key) =>
      saved[key] !== bases[key] &&
      (drafts[key] === bases[key] || drafts[key] === saved[key]),
  )
  if (follow.length > 0) {
    setBases({ ...bases, ...pick(saved, follow) })
    setDrafts({ ...drafts, ...pick(saved, follow) })
  }
  const [submitted, setSubmitted] = useState<Partial<MetadataValues>>({})
  const [status, setStatus] = useState<
    Partial<Record<MetadataKey, SaveStatus>>
  >({})

  const isDirty = (key: MetadataKey) =>
    drafts[key] !== bases[key] && drafts[key] !== submitted[key]
  const dirtyKeys = METADATA_KEYS.filter(isDirty)

  // "Saved" fades back to nothing after a moment.
  useEffect(() => {
    if (!Object.values(status).includes('saved')) return
    const timer = setTimeout(
      () =>
        setStatus((previous) =>
          Object.fromEntries(
            Object.entries(previous).filter(([, value]) => value !== 'saved'),
          ),
        ),
      2000,
    )
    return () => clearTimeout(timer)
  }, [status])

  const setFieldStatus = (keys: MetadataKey[], value: SaveStatus) =>
    setStatus((previous) => ({
      ...previous,
      ...Object.fromEntries(keys.map((key) => [key, value])),
    }))
  const forget = (keys: MetadataKey[]) =>
    setSubmitted((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(
          ([key]) => !keys.includes(key as MetadataKey),
        ),
      ),
    )

  /** Saves the given fields (default: every unsaved one); false on failure. */
  const save = async (keys: MetadataKey[] = dirtyKeys): Promise<boolean> => {
    const toSave = keys.filter(isDirty)
    if (toSave.length === 0 || localId === null) return true
    const update = pick(drafts, toSave)
    setSubmitted((previous) => ({ ...previous, ...update }))
    setFieldStatus(toSave, 'saving')
    try {
      await updateAsset(localId, update)
      setFieldStatus(toSave, 'saved')
      return true
    } catch (e) {
      forget(toSave)
      setFieldStatus(toSave, 'idle')
      toast.error(e, {
        title: t('media.metadataSaveFailed', 'Saving the metadata failed'),
      })
      return false
    }
  }

  /** Throws the given fields' drafts away (default: every unsaved one). */
  const revert = (keys: MetadataKey[] = dirtyKeys) => {
    setDrafts((previous) => ({ ...previous, ...pick(bases, keys) }))
    forget(keys)
  }

  return {
    drafts,
    setDraft: (key: MetadataKey, value: string) =>
      setDrafts((previous) => ({ ...previous, [key]: value })),
    isDirty,
    dirtyKeys,
    status,
    save,
    revert,
  }
}

/**
 * One metadata text field, behaving like the inspector's text editors: Enter
 * (mod+Enter when multi-line) or the inline apply button saves it, Escape or
 * the revert button discards its draft. Its state lives in useMetadataForm.
 */
function MetadataField({
  label,
  multiline,
  value,
  dirty,
  status,
  onChange,
  onApply,
  onRevert,
}: {
  label: string
  multiline: boolean
  value: string
  dirty: boolean
  status: SaveStatus
  onChange: (value: string) => void
  onApply: () => void
  onRevert: () => void
}) {
  const fieldProps = {
    value,
    'aria-label': label,
    'data-draft-target': '',
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange(event.target.value),
    onKeyDown: (
      event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (event.key === 'Escape' && dirty) {
        // Only cancel the draft - keep the dialog open.
        event.preventDefault()
        event.stopPropagation()
        onRevert()
      }
      if (event.key === 'Enter' && (!multiline || isApplyChord(event))) {
        event.preventDefault()
        onApply()
      }
    },
  }

  return (
    <Field label={label} status={status}>
      <DraftField
        dirty={dirty}
        placement={multiline ? 'bottom' : 'inline'}
        onApply={onApply}
        onRevert={onRevert}
      >
        {multiline ? <Textarea {...fieldProps} /> : <Input {...fieldProps} />}
      </DraftField>
    </Field>
  )
}

/** The tag tree as picker nodes. */
function tagTree(tags: AssetTag[]): PickerTreeNode[] {
  return tags.map((tag) => ({
    id: tag.id,
    label: tag.label,
    children: tagTree(tag.children),
  }))
}

/** Each tag's parent path ("Parent › Child"), by id - for the selected rows. */
function tagPaths(
  tags: AssetTag[],
  path: string[] = [],
  paths = new Map<string, string>(),
): Map<string, string> {
  for (const tag of tags) {
    paths.set(tag.id, path.join(' › '))
    tagPaths(tag.children, [...path, tag.label], paths)
  }
  return paths
}

/** Every label in a picker tree, lowercased - to tell whether a search names an existing entry. */
function treeLabels(nodes: PickerTreeNode[]): Set<string> {
  const labels = new Set<string>()
  const visit = (list: PickerTreeNode[]) =>
    list.forEach((node) => {
      labels.add(node.label.toLowerCase())
      visit(node.children)
    })
  visit(nodes)
  return labels
}

const CREATE_OPTION_ID = '__create__'

function TagAssignment({
  localId,
  assigned,
}: {
  localId: string
  assigned: { id: string; label: string }[]
}) {
  const tags = useAssetTags()
  const pathOf = tagPaths(tags.data ?? [])

  const setTag = (id: string, assign: boolean) =>
    setAssetTag(localId, id, assign).catch((e) =>
      toast.error(e, {
        title: assign
          ? t('media.tagAddFailed', 'Adding the tag failed')
          : t('media.tagRemoveFailed', 'Removing the tag failed'),
      }),
    )

  return (
    <AssignmentField
      label={t('media.tags', 'Tags')}
      placeholder={t('media.addTag', 'Add tag…')}
      iconClass="fas fa-tag"
      loading={tags.isLoading}
      roots={tagTree(tags.data ?? [])}
      assigned={assigned.map((tag) => ({
        id: tag.id,
        label: tag.label,
        secondary: pathOf.get(tag.id) || undefined,
      }))}
      onAdd={(id) => void setTag(id, true)}
      onRemove={(id) => void setTag(id, false)}
      createLabel={(term) => t('media.createTag', 'Create tag "{0}"', [term])}
      onCreate={async (label) => {
        try {
          const tag = await createAssetTag(label)
          await setAssetTag(localId, tag.id, true)
        } catch (e) {
          toast.error(e, {
            title: t('media.tagCreateFailed', 'Creating the tag failed'),
          })
        }
      }}
    />
  )
}

function CollectionAssignment({
  localId,
  assigned,
}: {
  localId: string
  assigned: { id: string; title: string }[]
}) {
  const collections = useAssetCollections()

  const setCollection = (id: string, assign: boolean) =>
    setAssetCollection(localId, id, assign).catch((e) =>
      toast.error(e, {
        title: assign
          ? t('media.collectionAddFailed', 'Adding to collection failed')
          : t(
              'media.collectionRemoveFailed',
              'Removing from collection failed',
            ),
      }),
    )

  return (
    <AssignmentField
      label={t('media.collections', 'Collections')}
      placeholder={t('media.addToCollection', 'Add to collection…')}
      iconClass="fas fa-folder"
      loading={collections.isLoading}
      // Collections are flat in Neos.Api - a tree of roots only. Nested
      // collections would just bring their children along here.
      roots={(collections.data ?? []).map((collection) => ({
        id: collection.id,
        label: collection.title,
        children: [],
      }))}
      assigned={assigned.map((collection) => ({
        id: collection.id,
        label: collection.title,
      }))}
      onAdd={(id) => void setCollection(id, true)}
      onRemove={(id) => void setCollection(id, false)}
    />
  )
}

interface AssignmentEntry {
  id: string
  label: string
  secondary?: string
}

/**
 * Tags / collections of the asset, built like the inspector's References
 * editor: the assigned entries as rows with a remove button, the shared
 * ReferencePicker below to add more - listing the entries as their tree
 * (expandable, all expanded at first), or, while searching, the matches by
 * label and parent path. Assigned entries stay in the tree with a check;
 * picking one again removes it. The popup stays open to toggle several in a
 * row. With onCreate, a search that names no entry offers to create it.
 */
function AssignmentField({
  label,
  placeholder,
  iconClass,
  loading,
  roots,
  assigned,
  onAdd,
  onRemove,
  createLabel,
  onCreate,
}: {
  label: string
  placeholder: string
  iconClass: string
  loading: boolean
  roots: PickerTreeNode[]
  assigned: AssignmentEntry[]
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  createLabel?: (term: string) => string
  onCreate?: (label: string) => Promise<void>
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  const assignedIds = new Set(assigned.map((entry) => entry.id))
  const term = searchTerm.trim()
  const options = treePickerOptions({
    roots,
    searchTerm,
    collapsed,
    onToggleExpanded: (id) =>
      setCollapsed((previous) => {
        const next = new Set(previous)
        if (!next.delete(id)) next.add(id)
        return next
      }),
    iconClass,
    checkedIds: assignedIds,
  })
  if (
    onCreate &&
    createLabel &&
    term !== '' &&
    !treeLabels(roots).has(term.toLowerCase())
  ) {
    options.push({
      id: CREATE_OPTION_ID,
      label: createLabel(term),
      iconClass: 'fas fa-plus',
    })
  }

  return (
    <Field label={label}>
      <div className="flex flex-col gap-1">
        {assigned.map((entry) => (
          <SelectedItemRow
            key={entry.id}
            iconClass={iconClass}
            label={entry.label}
            secondary={entry.secondary}
            onRemove={() => onRemove(entry.id)}
            removeLabel={t('media.removeLabel', 'Remove {0}', [entry.label])}
          />
        ))}
        <ReferencePicker
          triggerContent={
            <span className="text-muted-foreground">{placeholder}</span>
          }
          options={options}
          loading={loading}
          hint={null}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          onPick={(option) => {
            if (option.id === CREATE_OPTION_ID) void onCreate?.(term)
            else if (option.checked) onRemove(option.id)
            else onAdd(option.id)
          }}
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (!next) setSearchTerm('')
          }}
          closeOnPick={false}
        />
      </div>
    </Field>
  )
}

function RemoteImport({ asset }: { asset: Asset }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="sm"
      className="w-full"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await importAsset(asset.assetSourceId, asset.id)
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
      <i className="fas fa-download type-icon-xl" aria-hidden />
      {busy
        ? t('media.importing', 'Importing…')
        : t('media.importToNeos', 'Import to Neos')}
    </Button>
  )
}

function ReplaceButton({ asset, localId }: { asset: Asset; localId: string }) {
  const [replacing, setReplacing] = useState(false)

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setReplacing(true)}>
        <i className="fas fa-arrow-up-from-bracket type-icon-xl" aria-hidden />
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
        <i className="fas fa-trash-can type-icon-xl" aria-hidden />
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

function Field({
  label,
  status = 'idle',
  children,
}: {
  label: string
  /** A text field's save state, shown at the end of the label row. */
  status?: SaveStatus
  children: React.ReactNode
}) {
  // Matches the inspector's Labeled (same label row) so the dialog's fields
  // read like inspector properties.
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 type-small text-foreground">
        <h3>{label}</h3>
        {status !== 'idle' && (
          <span
            role="status"
            className="ml-auto flex items-center gap-1 text-muted-foreground"
          >
            <i
              className={cn(
                'fas type-icon-m',
                status === 'saving'
                  ? 'fa-spinner fa-spin'
                  : 'fa-check text-primary-text',
              )}
              aria-hidden
            />
            {status === 'saving'
              ? t('media.saving', 'Saving…')
              : t('media.saved', 'Saved')}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}
