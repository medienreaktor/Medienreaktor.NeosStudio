import { useMemo, useState } from 'react'

import { useAssets, type MediaAsset } from '@/api/media'
import { AssetDetailsPane } from './AssetDetailsPane'
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
 * The reusable three-pane asset browser: sources/collections/tags rail, the
 * filtered/paginated grid or list, and a details pane. Both the manage module
 * and a future picker dialog mount this same component.
 */
export function MediaBrowser({
  mode = 'manage',
  onPick,
  initialSource = 'neos',
}: MediaBrowserProps) {
  const state = useMediaBrowserState(initialSource)
  const [uploaderOpen, setUploaderOpen] = useState(false)

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
          isLoading={query.isLoading}
          isFetchingNextPage={query.isFetchingNextPage}
          hasNextPage={query.hasNextPage}
          onLoadMore={() => query.fetchNextPage()}
        />
      </div>

      {state.active && (
        <AssetDetailsPane
          asset={state.active}
          mode={mode}
          onClose={() => state.setActive(null)}
          onDeleted={() => state.setActive(null)}
          onPick={onPick}
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
