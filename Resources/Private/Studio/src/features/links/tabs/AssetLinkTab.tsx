import { useMemo, useState } from 'react'

import {
  DEFAULT_ASSET_FILTER,
  useAsset,
  useAssets,
  type MediaAsset,
} from '@/api/media'
import { localIdentifierFor } from '@/api/assetValue'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { AssetList } from '@/features/media/AssetList'
import { assetKey } from '@/features/media/useMediaBrowserState'
import { assetUri, parseAssetUri } from '../linkValue'
import type { LinkTypeTabProps } from '../registry'

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
      .catch((e: unknown) => toast.error(e, { title: 'Picking asset failed' }))
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="relative">
        <i
          className="fas fa-magnifying-glass pointer-events-none absolute top-1/2 left-2.5 text-[1rem] -translate-y-1/2 text-neutral-500"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search assets…"
          className="h-8 pl-8 text-sm"
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-neutral-800 bg-neutral-950">
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
        <p className="truncate text-xs text-neutral-400">
          Linked asset: {current.data.label}
        </p>
      )}
    </div>
  )
}
