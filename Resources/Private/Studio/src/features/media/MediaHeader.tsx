import { useRef, useState } from 'react'

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
import { SearchInput } from '@/components/ui/search-input'
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
    // Same fixed overlay toolbar as the documents/create panels.
    <div className="@container absolute top-0 right-0 left-0 z-10 flex shrink-0 flex-wrap items-center gap-2 bg-neutral-950/70 p-2 backdrop-blur-xs">
      <SearchInput
        value={filter.search}
        onChange={(e) => state.setSearch(e.target.value)}
        placeholder="Search assets…"
        aria-label="Search assets"
        wrapperClassName="min-w-40"
      />

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
        <div className="hidden @[64rem]:flex">
          <FilterButton
            icon={
              <i className="fas fa-layer-group text-[0.875rem]" aria-hidden />
            }
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
        </div>
      )}

      {supportsCollections && (
        <div className="hidden @[48rem]:flex">
          <FilterButton
            icon={<i className="fas fa-folder text-[0.875rem]" aria-hidden />}
            label={collectionLabel}
            active={filter.collection !== null}
            action={<AddCollection />}
          >
            <div className="min-w-56">
              <RailButton
                icon={
                  <i className="fas fa-folder text-[0.875rem]" aria-hidden />
                }
                label="All collections"
                active={filter.collection === null}
                onClick={() => state.selectCollection(null)}
              />
              <MediaTree
                label="Collections"
                emptyText="No collections yet"
                emptyIcon="fa-folder-open"
                loading={collections.isLoading}
                roots={(collections.data ?? []).map(collectionToNode)}
                selectedId={filter.collection}
                onSelect={(id) =>
                  state.selectCollection(filter.collection === id ? null : id)
                }
                icon={() => (
                  <i className="fas fa-folder text-[0.875rem]" aria-hidden />
                )}
                onItemContextMenu={(node, e) =>
                  openMenu(
                    { kind: 'collection', id: node.id, label: node.label },
                    e,
                  )
                }
              />
            </div>
          </FilterButton>
        </div>
      )}

      {supportsTagging && (
        <div className="hidden @[48rem]:flex">
          <FilterButton
            icon={<i className="fas fa-tag text-[0.875rem]" aria-hidden />}
            label={tagLabel}
            active={filter.tagMode === 'none' || filter.tag !== null}
            action={<AddTag />}
          >
            <div className="min-w-56">
              <RailButton
                icon={<i className="fas fa-tag text-[0.875rem]" aria-hidden />}
                label="All tags"
                active={filter.tagMode === 'given' && filter.tag === null}
                onClick={() => state.selectTag(null)}
              />
              <RailButton
                icon={<i className="fas fa-ban text-[0.875rem]" aria-hidden />}
                label="Untagged"
                active={filter.tagMode === 'none'}
                onClick={() => state.showUntagged()}
              />
              <MediaTree
                label="Tags"
                emptyText="No tags yet"
                emptyIcon="fa-tag"
                loading={tags.isLoading}
                roots={(tags.data ?? []).map(tagToNode)}
                selectedId={filter.tagMode === 'given' ? filter.tag : null}
                onSelect={(id) =>
                  state.selectTag(
                    filter.tagMode === 'given' && filter.tag === id ? null : id,
                  )
                }
                icon={() => (
                  <i className="fas fa-tag text-[0.875rem]" aria-hidden />
                )}
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
        </div>
      )}

      <div className="hidden @[48rem]:flex">
        <Select
          value={sortValue}
          onValueChange={(v) => {
            const sort = SORTS.find((s) => s.value === v)!
            state.setSort(sort.sortBy, sort.dir)
          }}
          items={SORTS.map((sort) => ({
            value: sort.value,
            label: sort.label,
          }))}
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
      </div>

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
          'flex h-8 items-center gap-1.5 rounded-md border px-2 text-sm bg-neutral-700/30 hover:bg-neutral-700/50',
          active ? 'text-white' : 'border-neutral-700 text-neutral-300 ',
        )}
      >
        <span
          className={cn('shrink-0', active ? 'text-white' : 'text-neutral-500')}
        >
          {icon}
        </span>
        <span className="max-w-40 truncate">{label}</span>
        <i
          className="fas fa-chevron-down text-[0.875rem] shrink-0 text-neutral-500"
          aria-hidden
        />
      </PopoverTrigger>
      <PopoverContent>
        {action && (
          <div className="mb-2 flex items-center justify-end">{action}</div>
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
          <i
            className="fas fa-layer-group text-[1rem] shrink-0 text-neutral-500"
            aria-hidden
          />
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
        'flex w-full items-center gap-1.5 border rounded-sm px-1.5 py-1 text-left text-sm',
        active
          ? 'bg-neutral-800 text-white border-blue-500'
          : 'hover:bg-neutral-800 border-transparent',
      )}
    >
      <span className="shrink-0">{icon}</span>
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
        variant="default"
        size="icon-xs"
        onClick={() => {
          handledRef.current = false
          setOpen(true)
        }}
        title={placeholder}
      >
        <i className="fas fa-plus text-[0.875rem]" aria-hidden />
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
