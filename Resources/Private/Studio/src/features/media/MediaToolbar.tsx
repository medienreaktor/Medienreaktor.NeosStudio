import {
  LayoutGridIcon,
  ListIcon,
  SearchIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react'

import type { AssetType } from '@/api/media'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
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

export function MediaToolbar({
  state,
  total,
  onUpload,
}: {
  state: MediaBrowserController
  total: number | undefined
  onUpload: () => void
}) {
  const { filter } = state
  const sortValue = `${filter.sortBy}-${filter.sortDirection}`

  return (
    <div className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-3 py-2">
      <div className="relative w-64 max-w-[40%]">
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

      {total !== undefined && (
        <span className="text-xs text-neutral-500">
          {total} asset{total === 1 ? '' : 's'}
        </span>
      )}

      <div className="ml-auto flex items-center gap-1">
        <div className="flex rounded-md border border-neutral-700">
          <ViewToggle
            active={state.view === 'grid'}
            onClick={() => state.setView('grid')}
            label="Grid view"
          >
            <LayoutGridIcon className="size-4" />
          </ViewToggle>
          <ViewToggle
            active={state.view === 'list'}
            onClick={() => state.setView('list')}
            label="List view"
          >
            <ListIcon className="size-4" />
          </ViewToggle>
        </div>
        <Button size="sm" onClick={onUpload}>
          <UploadIcon className="size-4" />
          Upload
        </Button>
      </div>
    </div>
  )
}

function ViewToggle({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'grid size-8 place-items-center first:rounded-l-md last:rounded-r-md',
        active
          ? 'bg-neutral-700 text-white'
          : 'text-neutral-400 hover:bg-neutral-800',
      )}
    >
      {children}
    </button>
  )
}
