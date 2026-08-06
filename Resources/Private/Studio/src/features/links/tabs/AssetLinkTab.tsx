import { useMemo, useState } from 'react'

import {
  DEFAULT_ASSET_FILTER,
  useAsset,
  useAssets,
  type MediaAsset,
} from '@/api/media'
import { localIdentifierFor } from '@/api/assetValue'
import { toast } from '@/components/ui/toast'
import { AssetList } from '@/features/media/AssetList'
import { assetKey } from '@/features/media/useMediaBrowserState'
import { translate as t } from '@/lib/i18n'
import { assetUri, parseAssetUri } from '../linkValue'
import type { LinkTypeTabProps } from '../registry'
import { SearchInput } from '@/components/ui/search-input'

/**
 * "Link to an asset": a compact Media Library picker - search plus the shared
 * asset grid - embedded in the Link Editor dialog (the modal overlays the
 * screen, so the panel-switching picker session the inspector editors use is
 * not an option here). Picking reports asset://<uuid>; a remote (DAM) asset
 * is imported first, so the stored identifier is always a local one, exactly
 * as the asset property editors do.
 */
export function AssetLinkTab({ href, onChange }: LinkTypeTabProps) {
  const identifier = href !== null ? parseAssetUri(href) : null
  const [search, setSearch] = useState('')
  const filter = useMemo(() => ({ ...DEFAULT_ASSET_FILTER, search }), [search])
  const query = useAssets(filter)
  const assets = query.data?.pages.flatMap((page) => page.assets) ?? []

  // Stored identifiers are always local, so they resolve against 'neos'.
  const current = useAsset('neos', identifier)

  const pick = (asset: MediaAsset) => {
    localIdentifierFor(asset)
      .then((id) => onChange(assetUri(id)))
      .catch((e: unknown) =>
        toast.error(e, {
          title: t('link.pickAssetFailed', 'Picking asset failed'),
        }),
      )
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-2">
      <div className="absolute left-0 top-0 right-0 z-10 p-px">
        <div className="relative w-full rounded-sm bg-white/70 dark:bg-neutral-950/70 p-2 backdrop-blur-xs">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('link.searchAssets', 'Search assets…')}
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
        <AssetList
          assets={assets}
          view="grid"
          activeKey={
            identifier !== null
              ? assetKey({ assetSource: 'neos', identifier })
              : null
          }
          onSelect={pick}
          onActivate={pick}
          isLoading={query.isLoading}
          isFetchingNextPage={query.isFetchingNextPage}
          hasNextPage={query.hasNextPage ?? false}
          onLoadMore={() => query.fetchNextPage()}
        />
      </div>
      {current.data && (
        <p className="truncate text-xs text-neutral-600 dark:text-neutral-400">
          {t('link.linkedAsset', 'Linked asset: {0}', [current.data.label])}
        </p>
      )}
    </div>
  )
}
