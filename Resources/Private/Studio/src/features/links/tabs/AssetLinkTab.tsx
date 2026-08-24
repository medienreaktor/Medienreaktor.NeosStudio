import { useMemo, useState } from 'react'

import { DEFAULT_ASSET_FILTER, useAssets, type MediaAsset } from '@/api/media'
import { localIdentifierFor } from '@/api/assetValue'
import { toast } from '@/components/ui/toast'
import { AssetList } from '@/features/media/AssetList'
import { assetKey } from '@/features/media/useMediaBrowserState'
import { translate as t } from '@/lib/i18n'
import { cn, floatingControl } from '@/lib/utils'
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
    // Same absolute overlay toolbar as the Media Library (MediaHeader): the
    // grid scrolls edge-to-edge under the toolbar's gradient (AssetList
    // brings the matching pt-14 clearance).
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        className={cn(
          // -top-px: the dialog is centered via translate(-50%), so at odd
          // dialog sizes the toolbar's top edge sits on a half pixel and
          // antialiases - a 1px line of the grid shows above it. Overlapping
          // upward paints grey on the tab panel's identical grey. No harm.
          'absolute inset-x-0 -top-px z-10 flex items-center p-3',
          // Not the shared toolbarFade: inside the dialog the tab panel is
          // neutral-50/900 (see TabsContent), not the panels' white/950.
          'bg-gradient-to-t from-transparent to-neutral-50 dark:to-neutral-900',
        )}
      >
        <SearchInput
          className={floatingControl}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('link.searchAssets', 'Search assets…')}
        />
      </div>
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
  )
}
