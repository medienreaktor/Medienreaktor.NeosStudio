import { useEffect, useMemo, useRef, useState } from 'react'

import { useAssets, type MediaAsset } from '@/api/media'
import { translate as t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { AssetContextMenu, type AssetMenuTarget } from './AssetContextMenu'
import { AssetDetailsDialog } from './AssetDetailsDialog'
import { AssetList } from './AssetList'
import { MediaFooter } from './MediaFooter'
import { MediaHeader } from './MediaHeader'
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
  /** Called in picker mode when the user abandons the pick (dismisses the banner). */
  onCancel?: () => void
  /** What the pick is for, shown in the picker banner (e.g. the target property label). */
  pickerTitle?: string
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
  onCancel,
  pickerTitle,
  initialSource = 'neos',
}: MediaBrowserProps) {
  const state = useMediaBrowserState(initialSource)
  const [uploaderOpen, setUploaderOpen] = useState(false)
  // The Media Library panel keeps a single MediaBrowser instance and flips its
  // mode when a pick starts (see MediaLibraryPanel), so any selection left over
  // from manage mode would otherwise carry into the picker. A pick always opens
  // with nothing selected.
  const { setActive } = state
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (mode !== 'picker') return
    setActive(null)
    // Take keyboard focus, so the Escape that cancels the pick (see
    // AssetPickerPanelBridge) works right away: the Select click that started
    // the pick left focus on the inspector's button or inside the preview
    // iframe, whose keystrokes the shell never sees. The panel switch that
    // reveals this browser lands in a follow-up render, and a display:none
    // element cannot take focus - hence the deferral past that render.
    const timer = window.setTimeout(
      () => rootRef.current?.focus({ preventScroll: true }),
      0,
    )
    return () => window.clearTimeout(timer)
  }, [mode, setActive])
  // Manage mode only: the asset whose metadata dialog is open.
  const [detailsAsset, setDetailsAsset] = useState<MediaAsset | null>(null)
  // Manage mode only: the asset a right-click context menu is open for.
  const [menuTarget, setMenuTarget] = useState<AssetMenuTarget | null>(null)

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
    <div
      ref={rootRef}
      // Focusable (by script only) so picker mode can claim the keyboard.
      tabIndex={-1}
      className="relative flex h-full min-h-0 flex-col outline-none"
    >
      {mode === 'picker' && (
        <div className="flex shrink-0 items-center justify-between gap-2 bg-blue-500 px-3 py-2 text-xs">
          <span className="min-w-0 truncate text-white">
            {t('media.pickAsset', 'Pick an asset')}
            {pickerTitle && (
              <>
                {' '}
                {t('media.for', 'for')}{' '}
                <span className="font-medium text-white">{pickerTitle}</span>
              </>
            )}{' '}
            {t('media.doubleClickToChoose', '— double-click to choose.')}
          </span>
          {onCancel && (
            <Button variant="ghost" size="xs" onClick={onCancel}>
              {t('media.cancel', 'Cancel')}
              {/* Escape cancels too (see AssetPickerPanelBridge) - say so. */}
              <kbd className="rounded border border-white/40 px-1 font-sans text-[10px] leading-4 text-white/90">
                Esc
              </kbd>
            </Button>
          )}
        </div>
      )}

      {/* The header is an absolute frosted overlay over the scrolling list,
          so both live in their own relative wrapper: in picker mode the
          in-flow notice above pushes the pair down instead of being covered
          by the overlay. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <MediaHeader state={state} />

        <AssetList
          assets={assets}
          view={state.view}
          activeKey={activeKey}
          onSelect={state.setActive}
          onActivate={activate}
          onContextMenu={
            mode === 'manage'
              ? (asset, anchor) => setMenuTarget({ asset, anchor })
              : undefined
          }
          isLoading={query.isLoading}
          isFetchingNextPage={query.isFetchingNextPage}
          hasNextPage={query.hasNextPage}
          onLoadMore={() => query.fetchNextPage()}
        />
      </div>

      <MediaFooter
        state={state}
        total={total}
        onUpload={() => setUploaderOpen(true)}
      />

      <AssetContextMenu
        target={menuTarget}
        onClose={() => setMenuTarget(null)}
        onEdit={setDetailsAsset}
      />

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
