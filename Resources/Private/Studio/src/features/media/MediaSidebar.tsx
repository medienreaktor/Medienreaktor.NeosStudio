import { useRef, useState } from 'react'
import {
  CircleSlashIcon,
  FolderIcon,
  LayersIcon,
  PlusIcon,
  TagIcon,
} from 'lucide-react'

import {
  createCollection,
  createTag,
  updateTag,
  useAssetCollections,
  useAssetSources,
  useTags,
  type AssetSource,
  type MediaCollection,
  type MediaTag,
} from '@/api/media'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { MediaItemActions, type MediaMenuTarget } from './MediaItemMenu'
import { MediaTree, type MediaTreeNode } from './MediaTree'
import type { MediaBrowserController } from './useMediaBrowserState'

/** Map the API's nested tag / flat collection shapes onto MediaTree nodes. */
function tagToNode(tag: MediaTag): MediaTreeNode {
  return {
    id: tag.identifier,
    label: tag.label,
    count: tag.assetCount,
    children: tag.children.map(tagToNode),
  }
}
function collectionToNode(collection: MediaCollection): MediaTreeNode {
  return {
    id: collection.identifier,
    label: collection.title,
    count: collection.assetCount,
    children: [],
  }
}

/** Left rail: asset-source switcher, collections list, and the tag tree. */
export function MediaSidebar({ state }: { state: MediaBrowserController }) {
  const sources = useAssetSources()
  const collections = useAssetCollections()
  const tags = useTags()
  const { filter } = state

  // The collection/tag the right-click context menu is open for.
  const [menuTarget, setMenuTarget] = useState<MediaMenuTarget | null>(null)
  const openMenu = (
    target: Omit<MediaMenuTarget, 'anchor'>,
    event: React.MouseEvent,
  ) => {
    event.preventDefault()
    setMenuTarget({ ...target, anchor: { x: event.clientX, y: event.clientY } })
  }

  const activeSource = sources.data?.find(
    (s) => s.identifier === filter.assetSource,
  )
  const supportsCollections = activeSource?.supportsCollections ?? true
  const supportsTagging = activeSource?.supportsTagging ?? true

  return (
    <div className="flex h-full w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-neutral-800 bg-neutral-950 p-3">
      {(sources.data?.length ?? 0) > 1 && (
        <Section title="Sources">
          <ul className="space-y-0.5">
            {sources.data!.map((source) => (
              <SourceButton
                key={source.identifier}
                source={source}
                active={source.identifier === filter.assetSource}
                onSelect={() => state.setAssetSource(source.identifier)}
              />
            ))}
          </ul>
        </Section>
      )}

      {supportsCollections && (
        <Section title="Collections" action={<AddCollection />}>
          <RailButton
            icon={<LayersIcon className="size-3.5" />}
            label="All assets"
            active={filter.collection === null}
            onClick={() => state.selectCollection(null)}
          />
          <MediaTree
            label="Collections"
            emptyText="No collections yet"
            roots={(collections.data ?? []).map(collectionToNode)}
            selectedId={filter.collection}
            onSelect={(id) =>
              state.selectCollection(filter.collection === id ? null : id)
            }
            icon={() => <FolderIcon className="size-3.5" />}
            onItemContextMenu={(node, e) =>
              openMenu(
                { kind: 'collection', id: node.id, label: node.label },
                e,
              )
            }
          />
        </Section>
      )}

      {supportsTagging && (
        <Section title="Tags" action={<AddTag />}>
          <RailButton
            icon={<TagIcon className="size-3.5" />}
            label="All tags"
            active={filter.tagMode === 'given' && filter.tag === null}
            onClick={() => state.selectTag(null)}
          />
          <RailButton
            icon={<CircleSlashIcon className="size-3.5" />}
            label="Untagged"
            active={filter.tagMode === 'none'}
            onClick={() => state.showUntagged()}
          />
          <MediaTree
            label="Tags"
            emptyText="No tags yet"
            roots={(tags.data ?? []).map(tagToNode)}
            selectedId={filter.tagMode === 'given' ? filter.tag : null}
            onSelect={(id) =>
              state.selectTag(
                filter.tagMode === 'given' && filter.tag === id ? null : id,
              )
            }
            icon={() => <TagIcon className="size-3.5" />}
            onItemContextMenu={(node, e) =>
              openMenu({ kind: 'tag', id: node.id, label: node.label }, e)
            }
            onReparent={(tagId, newParentId) =>
              // The API treats parent:null as "unchanged" and '' as "move to
              // root", so a top-level drop sends the empty string.
              void updateTag(tagId, { parent: newParentId ?? '' })
            }
          />
        </Section>
      )}

      <MediaItemActions
        target={menuTarget}
        onClose={() => setMenuTarget(null)}
      />
    </div>
  )
}

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-1.5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  )
}

function SourceButton({
  source,
  active,
  onSelect,
}: {
  source: AssetSource
  active: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        title={source.description}
        className={cn(
          'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm',
          active
            ? 'bg-blue-500/20 text-white'
            : 'text-neutral-300 hover:bg-neutral-800',
        )}
      >
        {source.iconUri ? (
          <img src={source.iconUri} alt="" className="size-4 shrink-0" />
        ) : (
          <LayersIcon className="size-4 shrink-0 text-neutral-500" />
        )}
        <span className="truncate">{source.label}</span>
        {source.isReadOnly && (
          <span className="ml-auto text-xs text-neutral-500">read-only</span>
        )}
      </button>
    </li>
  )
}

function RailButton({
  icon,
  label,
  count,
  active,
  onClick,
  onContextMenu,
}: {
  icon: React.ReactNode
  label: string
  count?: number
  active: boolean
  onClick: () => void
  onContextMenu?: (event: React.MouseEvent) => void
}) {
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={onClick}
        onContextMenu={onContextMenu}
        className={cn(
          'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm',
          active
            ? 'bg-blue-500/20 text-white'
            : 'text-neutral-300 hover:bg-neutral-800',
        )}
      >
        <span className="shrink-0 text-neutral-500">{icon}</span>
        <span className="truncate">{label}</span>
        {count !== undefined && count > 0 && (
          <span className="ml-auto shrink-0 text-xs text-neutral-500">
            {count}
          </span>
        )}
      </button>
    </li>
  )
}

/** Inline "+" that reveals a one-field create form. Shared shape for both. */
function InlineCreate({
  placeholder,
  onCreate,
}: {
  placeholder: string
  onCreate: (value: string) => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  // Guards against a double create: pressing Enter submits and closes the
  // input, whose unmount fires onBlur with a stale `value` that would submit
  // again. The ref is reset each time the field is (re)opened.
  const handledRef = useRef(false)

  async function submit() {
    if (handledRef.current) return
    const trimmed = value.trim()
    if (!trimmed) {
      setOpen(false)
      return
    }
    handledRef.current = true
    setBusy(true)
    try {
      await onCreate(trimmed)
      setValue('')
      setOpen(false)
    } catch {
      // Let the user retry on failure.
      handledRef.current = false
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => {
          handledRef.current = false
          setOpen(true)
        }}
        title={placeholder}
      >
        <PlusIcon className="size-3.5" />
      </Button>
    )
  }
  return (
    <Input
      autoFocus
      value={value}
      disabled={busy}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void submit()
        if (e.key === 'Escape') setOpen(false)
      }}
      onBlur={() => (value.trim() ? void submit() : setOpen(false))}
      className="h-6 w-32 text-xs"
    />
  )
}

function AddCollection() {
  return (
    <InlineCreate placeholder="New collection" onCreate={createCollection} />
  )
}

function AddTag() {
  return (
    <InlineCreate
      placeholder="New tag"
      onCreate={(label) => createTag(label)}
    />
  )
}
