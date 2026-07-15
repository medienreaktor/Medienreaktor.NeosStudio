import { useCallback, useMemo, useState } from 'react'

import {
  DEFAULT_ASSET_FILTER,
  type AssetListFilter,
  type AssetType,
  type MediaAsset,
} from '@/api/media'

export type MediaViewMode = 'grid' | 'list'

/** A stable key for an asset across sources - used for selection sets. */
export function assetKey(
  asset: Pick<MediaAsset, 'assetSource' | 'identifier'>,
): string {
  return `${asset.assetSource}:${asset.identifier}`
}

/**
 * All local state the browser drives: the list filter, the view mode, and the
 * current selection. Kept in one hook so both the manage module and a future
 * picker dialog get identical behaviour.
 */
export function useMediaBrowserState(initialSource = 'neos') {
  const [filter, setFilter] = useState<AssetListFilter>({
    ...DEFAULT_ASSET_FILTER,
    assetSource: initialSource,
  })
  const [view, setView] = useState<MediaViewMode>('grid')
  const [active, setActive] = useState<MediaAsset | null>(null)

  const patch = useCallback((next: Partial<AssetListFilter>) => {
    setFilter((current) => ({ ...current, ...next }))
  }, [])

  const actions = useMemo(
    () => ({
      setAssetSource: (assetSource: string) =>
        // Switching sources resets collection/tag scoping (they are per-source).
        setFilter((c) => ({
          ...c,
          assetSource,
          collection: null,
          tag: null,
          tagMode: 'given' as const,
        })),
      setType: (type: AssetType | 'All') => patch({ type }),
      setSearch: (search: string) => patch({ search }),
      setSort: (
        sortBy: AssetListFilter['sortBy'],
        sortDirection: AssetListFilter['sortDirection'],
      ) => patch({ sortBy, sortDirection }),
      selectCollection: (collection: string | null) => patch({ collection }),
      selectTag: (tag: string | null) => patch({ tag, tagMode: 'given' }),
      showUntagged: () => patch({ tag: null, tagMode: 'none' }),
    }),
    [patch],
  )

  return { filter, ...actions, view, setView, active, setActive }
}

export type MediaBrowserController = ReturnType<typeof useMediaBrowserState>
