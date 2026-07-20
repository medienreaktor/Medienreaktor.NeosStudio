import { useEffect, useRef } from 'react'

import type { MediaAsset } from '@/api/media'
import { cn } from '@/lib/utils'
import { LoadingState, Spinner } from '@/components/ui/spinner'
import { Placeholder } from '@/components/ui/placeholder'
import { AssetThumb } from './AssetThumb'
import { formatBytes, formatDate } from './format'
import { assetKey } from './useMediaBrowserState'
import type { MediaViewMode } from './useMediaBrowserState'

interface AssetListProps {
  assets: MediaAsset[]
  view: MediaViewMode
  activeKey: string | null
  onSelect: (asset: MediaAsset) => void
  /** Double-click / Enter: open details (manage) or pick (picker). */
  onActivate: (asset: MediaAsset) => void
  isLoading: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  onLoadMore: () => void
}

export function AssetList({
  assets,
  view,
  activeKey,
  onSelect,
  onActivate,
  isLoading,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
}: AssetListProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasNextPage) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) onLoadMore()
      },
      { rootMargin: '400px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, onLoadMore, assets.length])

  if (assets.length === 0) {
    return isLoading ? (
      <LoadingState label="Loading assets…" />
    ) : (
      <Placeholder
        icon="fa-photo-film"
        title="No assets match the current filters."
      />
    )
  }

  return (
    <div className="min-h-0 flex-1 pt-12 overflow-y-auto @container">
      {view === 'grid' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2 p-2 pt-0">
          {assets.map((asset) => (
            <GridCard
              key={assetKey(asset)}
              asset={asset}
              active={assetKey(asset) === activeKey}
              onClick={() => onSelect(asset)}
              onActivate={() => onActivate(asset)}
            />
          ))}
        </div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-neutral-900 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-2 py-2 font-medium">Type</th>
              <th className="px-2 py-2 font-medium">Size</th>
              <th className="px-4 py-2 font-medium">Modified</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <ListRow
                key={assetKey(asset)}
                asset={asset}
                active={assetKey(asset) === activeKey}
                onClick={() => onSelect(asset)}
                onActivate={() => onActivate(asset)}
              />
            ))}
          </tbody>
        </table>
      )}

      <div ref={sentinelRef} />
      {isFetchingNextPage && (
        <div className="flex items-center justify-center gap-2 p-4 text-xs text-neutral-500">
          <Spinner className="text-[0.875rem]" />
          Loading more…
        </div>
      )}
    </div>
  )
}

function GridCard({
  asset,
  active,
  onClick,
  onActivate,
}: {
  asset: MediaAsset
  active: boolean
  onClick: () => void
  onActivate: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onActivate()
      }}
      title={asset.label}
      className={cn(
        'group flex flex-col overflow-hidden rounded-md border bg-neutral-900 text-left transition-colors',
        active
          ? 'border-blue-500 ring-1 ring-blue-500'
          : 'border-neutral-800 hover:border-neutral-600',
      )}
    >
      <div className="grid aspect-square place-items-center overflow-hidden bg-neutral-950/50 p-2">
        <AssetThumb asset={asset} />
      </div>
      <div className="border-t border-neutral-800 px-2 py-1.5">
        <p className="truncate text-xs text-neutral-200">{asset.label}</p>
        <p className="truncate text-[0.65rem] text-neutral-500">
          {formatBytes(asset.fileSize)}
        </p>
      </div>
    </button>
  )
}

function ListRow({
  asset,
  active,
  onClick,
  onActivate,
}: {
  asset: MediaAsset
  active: boolean
  onClick: () => void
  onActivate: () => void
}) {
  return (
    <tr
      onClick={onClick}
      onDoubleClick={onActivate}
      className={cn(
        'cursor-pointer border-b border-neutral-800/60',
        active ? 'bg-blue-500/15' : 'hover:bg-neutral-800/50',
      )}
    >
      <td className="px-4 py-1.5">
        <div className="flex items-center gap-2">
          <div className="grid size-8 shrink-0 place-items-center overflow-hidden rounded bg-neutral-950/50">
            <AssetThumb asset={asset} className="size-5" />
          </div>
          <span className="truncate text-neutral-200">{asset.label}</span>
        </div>
      </td>
      <td className="px-2 py-1.5 text-neutral-400">{asset.assetType}</td>
      <td className="px-2 py-1.5 text-neutral-400">
        {formatBytes(asset.fileSize)}
      </td>
      <td className="px-4 py-1.5 text-neutral-400">
        {formatDate(asset.lastModified)}
      </td>
    </tr>
  )
}
