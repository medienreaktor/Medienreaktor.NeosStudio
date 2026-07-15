import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

import type { MediaAsset } from '@/api/media'
import { usePanelSwitcher } from '@/features/panels/PanelSystem'

/**
 * The asset picker session: how an inspector editor hands off to the Media
 * Library to choose an asset. Rather than a separate modal, a live session
 * switches the main area to the Media Library in picker mode - the floating
 * Inspector stays visible beside it, so the editor that asked keeps its
 * context. Picking (or cancelling) resolves the session and switches the main
 * area back to the tab that was active before.
 *
 * One session is live at a time (the editor triggering a pick is the only one
 * that can, since the Media Library then owns the screen). This is the seed of
 * a plugin API: any editor can `requestPick` without knowing anything about the
 * panel layout.
 *
 * Provider structure matters: <AssetPickerProvider> wraps <PanelsProvider> so
 * that editors inside floating panels (the Inspector is portalled out by the
 * panel system) still see this context. The panel switching itself needs the
 * panel context, so it lives in <AssetPickerPanelBridge>, mounted *inside*
 * <PanelsProvider>. The provider therefore knows nothing about panels; the
 * bridge reacts to the session it exposes.
 */

const MEDIA_LIBRARY_PANEL = 'media-library'

export interface AssetPickerRequest {
  /** The field the pick is for, shown in the picker banner (e.g. the property label). */
  title?: string
  /** Called with the chosen asset when the user picks one. */
  onPick: (asset: MediaAsset) => void
}

interface AssetPickerContextValue {
  /** The live session, or null when the Media Library is in its normal manage mode. */
  session: AssetPickerRequest | null
  /** Open the Media Library in picker mode for `request`. */
  requestPick: (request: AssetPickerRequest) => void
  /** Complete the live session with the chosen asset. */
  resolve: (asset: MediaAsset) => void
  /** Abandon the live session without a pick. */
  cancel: () => void
}

const AssetPickerContext = createContext<AssetPickerContextValue | null>(null)

export function useAssetPicker(): AssetPickerContextValue {
  const context = useContext(AssetPickerContext)
  if (!context)
    throw new Error('useAssetPicker must be used within <AssetPickerProvider>')
  return context
}

export function AssetPickerProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [session, setSession] = useState<AssetPickerRequest | null>(null)

  const requestPick = useCallback((request: AssetPickerRequest) => {
    setSession(request)
  }, [])

  const cancel = useCallback(() => setSession(null), [])

  // Not stable across sessions by design: the fresh closure is handed through
  // context each render, and the side-effecting onPick must run outside the
  // state updater (StrictMode invokes updaters twice, which would double-pick).
  const resolve = useCallback(
    (asset: MediaAsset) => {
      session?.onPick(asset)
      setSession(null)
    },
    [session],
  )

  return (
    <AssetPickerContext.Provider
      value={{ session, requestPick, resolve, cancel }}
    >
      {children}
    </AssetPickerContext.Provider>
  )
}

/**
 * Drives the panel switch for the picker. Mount once inside <PanelsProvider>
 * (which is inside <AssetPickerProvider>): when a session opens it focuses the
 * Media Library, and when it closes it restores the main tab that was active
 * before - unless the Media Library already was it (e.g. torn out to float),
 * in which case there is nothing to switch back to.
 */
export function AssetPickerPanelBridge() {
  const { session } = useAssetPicker()
  const { activate, activeMainPanel } = usePanelSwitcher()
  const active = session !== null
  const wasActive = useRef(false)
  const returnTo = useRef<string | null>(null)

  useEffect(() => {
    if (active && !wasActive.current) {
      returnTo.current = activeMainPanel
      activate(MEDIA_LIBRARY_PANEL)
    } else if (!active && wasActive.current) {
      if (returnTo.current && returnTo.current !== MEDIA_LIBRARY_PANEL)
        activate(returnTo.current)
      returnTo.current = null
    }
    wasActive.current = active
  }, [active, activate, activeMainPanel])

  return null
}
