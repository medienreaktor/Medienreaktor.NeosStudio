import { useRef, useState } from 'react'
import {
  ChevronDownIcon,
  CircleSlashIcon,
  FolderIcon,
  LayersIcon,
  PlusIcon,
  SearchIcon,
  TagIcon,
  XIcon,
} from 'lucide-react'

import {
  createCollection,
  createTag,
  updateTag,
  useAssetCollections,
  useAssetSources,
  useTags,
  type AssetSource,
  type AssetType,
  type MediaCollection,
  type MediaTag,
} from '@/api/media'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { MediaItemActions, type MediaMenuTarget } from './MediaItemMenu'
import { MediaTree, type MediaTreeNode } from './MediaTree'
import type { MediaBrowserController } from './useMediaBrowserState'

const TYPES: Array<AssetType | 'All'> = [
  'All',
  'Image',
  'Document',
  'Video',
  'Audio',
]

const SORTS: Array<{
  value: string
  label: string
  sortBy: 'modified' | 'name'
  dir: 'asc' | 'desc'
}> = [
  {
    value: 'modified-desc',
    label: 'Newest first',
    sortBy: 'modified',
    dir: 'desc',
  },
  {
    value: 'modified-asc',
    label: 'Oldest first',
    sortBy: 'modified',
    dir: 'asc',
  },
  { value: 'name-asc', label: 'Name A–Z', sortBy: 'name', dir: 'asc' },
  { value: 'name-desc', label: 'Name Z–A', sortBy: 'name', dir: 'desc' },
]

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

/**
 * The Media Library header: free-text search plus every filter. Asset source,
 * collections and tags are themselves filters, so each is a dropdown holding
 * its tree (and an inline "+" to create new entries) rather than a permanent
 * left rail. Type and sort are plain selects.
 */
export function MediaHeader({ state }: { state: MediaBrowserController }) {
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
  const hasSources = (sources.data?.length ?? 0) > 1

  const sortValue = `${filter.sortBy}-${filter.sortDirection}`

  const collectionLabel =
    filter.collection === null
      ? 'All collections'
      : (collections.data?.find((c) => c.identifier === filter.collection)
          ?.title ?? 'Collection')

  const tagLabel =
    filter.tagMode === 'none'
      ? 'Untagged'
      : filter.tag === null
        ? 'All tags'
        : (flattenTags(tags.data ?? []).find((t) => t.identifier === filter.tag)
            ?.label ?? 'Tag')

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-3 py-2">
      <div className="relative min-w-40 flex-1">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-neutral-500" />
        <Input
          value={filter.search}
          onChange={(e) => state.setSearch(e.target.value)}
          placeholder="Search assets…"
          className="h-8 pl-8 pr-8"
        />
        {filter.search && (
          <button
            type="button"
            onClick={() => state.setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
            aria-label="Clear search"
          >
            <XIcon className="size-4" />
          </button>
        )}
      </div>

      <Select
        value={filter.type}
        onValueChange={(v) => state.setType(v as AssetType | 'All')}
        items={TYPES.map((type) => ({
          value: type,
          label: type === 'All' ? 'All types' : type,
        }))}
      >
        <SelectTrigger className="h-8 w-32" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TYPES.map((type) => (
            <SelectItem key={type} value={type}>
              {type === 'All' ? 'All types' : type}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasSources && (
        <FilterButton
          icon={<LayersIcon className="size-3.5" />}
          label={activeSource?.label ?? 'Source'}
        >
          <ul className="min-w-48 space-y-0.5">
            {sources.data!.map((source) => (
              <SourceButton
                key={source.identifier}
                source={source}
                active={source.identifier === filter.assetSource}
                onSelect={() => state.setAssetSource(source.identifier)}
              />
            ))}
          </ul>
        </FilterButton>
      )}

      {supportsCollections && (
        <FilterButton
          icon={<FolderIcon className="size-3.5" />}
          label={collectionLabel}
          active={filter.collection !== null}
          action={<AddCollection />}
        >
          <div className="min-w-56">
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
          </div>
        </FilterButton>
      )}

      {supportsTagging && (
        <FilterButton
          icon={<TagIcon className="size-3.5" />}
          label={tagLabel}
          active={filter.tagMode === 'none' || filter.tag !== null}
          action={<AddTag />}
        >
          <div className="min-w-56">
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
                // parent:null is "unchanged"; '' moves to root.
                void updateTag(tagId, { parent: newParentId ?? '' })
              }
            />
          </div>
        </FilterButton>
      )}

      <Select
        value={sortValue}
        onValueChange={(v) => {
          const sort = SORTS.find((s) => s.value === v)!
          state.setSort(sort.sortBy, sort.dir)
        }}
        items={SORTS.map((sort) => ({ value: sort.value, label: sort.label }))}
      >
        <SelectTrigger className="h-8 w-36" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORTS.map((sort) => (
            <SelectItem key={sort.value} value={sort.value}>
              {sort.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <MediaItemActions
        target={menuTarget}
        onClose={() => setMenuTarget(null)}
      />
    </div>
  )
}

/**
 * A filter chip that opens a popover. Shows an icon, the current selection and
 * a chevron, highlighting when the filter is narrowed. `action` (an inline "+")
 * sits in the popover header for creating new entries.
 */
function FilterButton({
  icon,
  label,
  active = false,
  action,
  children,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-md border px-2 text-sm',
          active
            ? 'border-blue-500/50 bg-blue-500/15 text-white'
            : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800',
        )}
      >
        <span className="shrink-0 text-neutral-400">{icon}</span>
        <span className="max-w-40 truncate">{label}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-neutral-500" />
      </PopoverTrigger>
      <PopoverContent>
        {action && (
          <div className="mb-1 flex items-center justify-end">{action}</div>
        )}
        {children}
      </PopoverContent>
    </Popover>
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
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm',
        active
          ? 'bg-blue-500/20 text-white'
          : 'text-neutral-300 hover:bg-neutral-800',
      )}
    >
      <span className="shrink-0 text-neutral-500">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}

/** Inline "+" that reveals a one-field create form. Shared by both trees. */
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
  // Guards a double create: Enter submits and closes the input, whose unmount
  // fires onBlur with a stale value that would submit again. Reset on reopen.
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
      className="h-6 w-40 text-xs"
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
