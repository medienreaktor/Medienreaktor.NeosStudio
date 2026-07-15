import { useState } from 'react'
import { CircleSlashIcon, FolderIcon, LayersIcon, PlusIcon } from 'lucide-react'

import {
  createCollection,
  createTag,
  useAssetCollections,
  useAssetSources,
  useTags,
  type AssetSource,
} from '@/api/media'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { TagTree } from './TagTree'
import type { MediaBrowserController } from './useMediaBrowserState'

/** Left rail: asset-source switcher, collections list, and the tag tree. */
export function MediaSidebar({ state }: { state: MediaBrowserController }) {
  const sources = useAssetSources()
  const collections = useAssetCollections()
  const tags = useTags()
  const { filter } = state

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
          <ul className="space-y-0.5">
            <RailButton
              icon={<LayersIcon className="size-3.5" />}
              label="All assets"
              active={filter.collection === null}
              onClick={() => state.selectCollection(null)}
            />
            {collections.data?.map((collection) => (
              <RailButton
                key={collection.identifier}
                icon={<FolderIcon className="size-3.5" />}
                label={collection.title}
                count={collection.assetCount}
                active={filter.collection === collection.identifier}
                onClick={() => state.selectCollection(collection.identifier)}
              />
            ))}
          </ul>
        </Section>
      )}

      {supportsTagging && (
        <Section title="Tags" action={<AddTag />}>
          <RailButton
            icon={<CircleSlashIcon className="size-3.5" />}
            label="Untagged"
            active={filter.tagMode === 'none'}
            onClick={() => state.showUntagged()}
          />
          <div className="mt-0.5">
            <TagTree
              tags={tags.data ?? []}
              selectedTag={filter.tag}
              onSelect={state.selectTag}
            />
          </div>
        </Section>
      )}
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
}: {
  icon: React.ReactNode
  label: string
  count?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <li className="list-none">
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

  async function submit() {
    const trimmed = value.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      await onCreate(trimmed)
      setValue('')
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => setOpen(true)}
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
