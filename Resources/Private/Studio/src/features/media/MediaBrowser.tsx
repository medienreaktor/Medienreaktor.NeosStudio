import { useMemo, useState } from 'react'

import { useAssets, type MediaAsset } from '@/api/media'
import { AssetDetailsDialog } from './AssetDetailsDialog'
import { AssetList } from './AssetList'
import { MediaSidebar } from './MediaSidebar'
import { MediaToolbar } from './MediaToolbar'
import { MediaUploader } from './MediaUploader'
import { assetKey, useMediaBrowserState } from './useMediaBrowserState'

export interface MediaBrowserProps {
  /**
   * "manage" is the full media module (edit, delete, upload). "picker" adds a
   * confirm affordance and hides destructive actions, for reuse as an asset
   * picker on node properties (wired later).
   */
  mode?: 'manage' | 'picker'
  /** Called in picker mode when the user confirms an asset. */
  onPick?: (asset: MediaAsset) => void
  /** Restrict the initial source (e.g. a picker constrained to one DAM). */
  initialSource?: string
}

/**
 * The reusable asset browser: sources/collections/tags rail plus the
 * filtered/paginated grid or list. Both the manage module and a future picker
 * dialog mount this same component. Double-clicking an asset opens its metadata
 * in a modal (manage) or inserts it into the editor (picker).
 */
export function MediaBrowser({
  mode = 'manage',
  onPick,
  initialSource = 'neos',
}: MediaBrowserProps) {
  const state = useMediaBrowserState(initialSource)
  const [uploaderOpen, setUploaderOpen] = useState(false)
  // Manage mode only: the asset whose metadata dialog is open.
  const [detailsAsset, setDetailsAsset] = useState<MediaAsset | null>(null)

  const activate = (asset: MediaAsset) => {
    if (mode === 'picker') onPick?.(asset)
    else setDetailsAsset(asset)
  }

  const query = useAssets(state.filter)
  const assets = useMemo(
    () => query.data?.pages.flatMap((page) => page.assets) ?? [],
    [query.data],
  )
  const total = query.data?.pages[0]?.pagination.total

  const activeKey = state.active ? assetKey(state.active) : null

  return (
    <div className="relative flex h-full min-h-0">
      <MediaSidebar state={state} />

      <div className="flex min-w-0 flex-1 flex-col">
        <MediaToolbar
          state={state}
          total={total}
          onUpload={() => setUploaderOpen(true)}
        />
        <AssetList
          assets={assets}
          view={state.view}
          activeKey={activeKey}
          onSelect={state.setActive}
          onActivate={activate}
          isLoading={query.isLoading}
          isFetchingNextPage={query.isFetchingNextPage}
          hasNextPage={query.hasNextPage}
          onLoadMore={() => query.fetchNextPage()}
        />
      </div>

      {detailsAsset && (
        <AssetDetailsDialog
          asset={detailsAsset}
          onOpenChange={(open) => !open && setDetailsAsset(null)}
          onDeleted={() => setDetailsAsset(null)}
        />
      )}

      {uploaderOpen && (
        <MediaUploader
          collection={state.filter.collection}
          tag={state.filter.tagMode === 'given' ? state.filter.tag : null}
          onClose={() => setUploaderOpen(false)}
        />
      )}
    </div>
  )
}
