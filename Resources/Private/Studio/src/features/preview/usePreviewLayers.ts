import { useEffect, useRef, useState } from 'react'
import { reportPreviewLoaded } from '@/app/boot'
import { toast } from '@/components/ui/toast'
import { captureShortcuts } from '@/features/shortcuts/registry'
import { useLatestRef } from '@/hooks/use-latest-ref'
import { translate as t } from '@/lib/i18n'

/**
 * One stacked preview iframe. Navigations and reloads mount a fresh layer on
 * top of the current one and fade it in once it is ready, so a page swap
 * crossfades instead of flashing white through a torn-down iframe.
 */
export type PreviewLayer = {
  /** Stable identity, so React keeps (never remounts) the element. */
  id: number
  src: string
  /** src plus the reload counters - a change means "load a fresh frame". */
  loadKey: string
  /** The layer is faded in and takes over the bridge. */
  ready: boolean
  /**
   * Its guest script reported in. False for a page rendered without it (a
   * read-only page) or whose guest never answered (see GUEST_READY_TIMEOUT_MS)
   * - the frame shows, but nothing guest-facing is posted into it.
   */
  guestReady: boolean
}

/** Matches the iframe's opacity transition - lower layers retire after it. */
const CROSSFADE_MS = 50

/**
 * How long an edit-mode frame may take from its load event to the guest's
 * handshake. The guest boots at DOMContentLoaded, so a frame that loaded
 * without reporting in within this window has no guest: the site's markup
 * dropped the injected script, or it failed (a CSP, a script error before
 * init). The frame is shown anyway rather than kept invisible forever.
 */
const GUEST_READY_TIMEOUT_MS = 4000

/**
 * The stacked preview frames of PreviewPane: creates a layer per load key,
 * fades it in once ready, retires the layers beneath it - flushing their
 * pending inline edits first - and forwards the shell's keyboard shortcuts
 * from every ready frame.
 *
 * `guestless` marks pages rendered without the editing guest (deleted, or
 * outside the account's access roles): their layers turn ready on load.
 * `flushBeforeRetire` asks a frame's guest to post its pending edits; the
 * returned promise settles when it answered (or gave up waiting).
 */
export function usePreviewLayers({
  src,
  loadKey,
  guestless,
  flushBeforeRetire,
}: {
  src: string | null
  loadKey: string | null
  guestless: boolean
  flushBeforeRetire: (frame: Window) => Promise<void>
}) {
  // Double-buffered iframes stacked front-to-back: the last layer is the
  // incoming/active one, earlier layers are the outgoing page still painted
  // beneath it during the crossfade.
  const [layers, setLayers] = useState<PreviewLayer[]>([])
  // Live iframe elements by layer id, for identifying message senders and
  // for posting to the active frame.
  const framesRef = useRef(new Map<number, HTMLIFrameElement>())
  // The windows of frames already removed. Their guest may still be posting
  // the edits it flushed on pagehide; those must not be dropped as coming
  // from an unknown sender.
  const retiredWindowsRef = useRef(new WeakSet<Window>())
  // The topmost ready frame - the one the shell bridges to.
  const activeFrameRef = useRef<HTMLIFrameElement | null>(null)
  const nextLayerIdRef = useRef(0)
  const flushRef = useLatestRef(flushBeforeRetire)

  // A guest reporting in late (after the timeout showed its frame without
  // it) still upgrades the layer; nothing ever downgrades one.
  const markLayerReady = (id: number, guestReady: boolean) =>
    setLayers((previous) =>
      previous.map((layer) =>
        layer.id === id && (!layer.ready || (guestReady && !layer.guestReady))
          ? {
              ...layer,
              ready: true,
              guestReady: layer.guestReady || guestReady,
            }
          : layer,
      ),
    )

  // Start a new frame whenever the load key changes. We keep only the most
  // recent ready layer as the fading-out background plus the new incoming
  // layer, so at most two iframes are ever live.
  useEffect(() => {
    if (!loadKey || !src) return
    const id = ++nextLayerIdRef.current
    setLayers((previous) => {
      if (previous[previous.length - 1]?.loadKey === loadKey) return previous
      const background = previous.filter((layer) => layer.ready).slice(-1)
      // The v parameter (ignored by the server) makes every load's URL
      // unique: reloading the same document repeats the exact same GET
      // otherwise, and Safari answers repeated URLs from its HTTP cache -
      // stale entries stored under earlier, weaker caching headers included,
      // which response headers alone can never evict.
      return [
        ...background,
        {
          id,
          src: `${src}&v=${Date.now()}`,
          loadKey,
          ready: false,
          guestReady: false,
        },
      ]
    })
  }, [loadKey, src])

  // Once the incoming (topmost) layer is ready it becomes the bridge target
  // and fades in; after the crossfade the layers beneath it are flushed and
  // retire.
  useEffect(() => {
    const top = layers[layers.length - 1]
    if (!top?.ready) return
    activeFrameRef.current = framesRef.current.get(top.id) ?? null
    // The shell's boot screen waits for the first painted page.
    reportPreviewLoaded()
    if (layers.length <= 1) return
    const lower = layers.slice(0, -1)
    let cancelled = false
    const timer = setTimeout(() => {
      // Edits still debouncing in an outgoing frame are posted before it
      // goes; the guest's own pagehide flush is the safety net behind this.
      void Promise.all(
        lower.map((layer) => {
          const frame = framesRef.current.get(layer.id)?.contentWindow
          return layer.guestReady && frame ? flushRef.current(frame) : undefined
        }),
      ).then(() => {
        // A newer layer arrived meanwhile: its own pass retires these too.
        if (cancelled) return
        setLayers((previous) => {
          const index = previous.findIndex((layer) => layer.id === top.id)
          return index > 0 ? previous.slice(index) : previous
        })
      })
    }, CROSSFADE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [layers, flushRef]) // flushRef: a stable ref

  // Shell shortcuts keep working while focus sits inside a frame (inline
  // editing): each ready frame forwards its keydowns to the registry - the
  // frames are same-origin. Removed again when the layer retires.
  const shortcutCapturesRef = useRef(new Map<number, () => void>())
  useEffect(() => {
    const captures = shortcutCapturesRef.current
    const live = new Set(layers.map((layer) => layer.id))
    for (const [id, uninstall] of captures) {
      if (live.has(id)) continue
      uninstall()
      captures.delete(id)
    }
    for (const layer of layers) {
      if (!layer.ready || captures.has(layer.id)) continue
      const frame = framesRef.current.get(layer.id)?.contentWindow
      if (!frame) continue
      try {
        captures.set(layer.id, captureShortcuts(frame))
      } catch {
        /* not same-origin after all - its keystrokes stay with the frame */
      }
    }
  }, [layers])
  useEffect(() => {
    const captures = shortcutCapturesRef.current
    return () => {
      for (const uninstall of captures.values()) uninstall()
      captures.clear()
    }
  }, [])

  // A frame that loaded but whose guest never reported in: shown without the
  // bridge after GUEST_READY_TIMEOUT_MS (see there), with a hint why nothing
  // in it responds to clicks.
  const guestTimersRef = useRef(new Map<number, number>())
  useEffect(() => {
    const timers = guestTimersRef.current
    for (const layer of layers) {
      if (!layer.ready) continue
      const timer = timers.get(layer.id)
      if (timer === undefined) continue
      clearTimeout(timer)
      timers.delete(layer.id)
    }
  }, [layers])
  useEffect(() => {
    const timers = guestTimersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const onFrameLoad = (layer: PreviewLayer) => {
    // Guest-less pages have to report their own readiness, or the layer
    // never fades in.
    if (guestless) {
      markLayerReady(layer.id, false)
      return
    }
    if (layer.ready || guestTimersRef.current.has(layer.id)) return
    guestTimersRef.current.set(
      layer.id,
      window.setTimeout(() => {
        guestTimersRef.current.delete(layer.id)
        markLayerReady(layer.id, false)
        toast.info(
          t(
            'preview.guestMissing',
            'The page loaded without the Studio editing script - selecting and editing in the preview are unavailable on it.',
          ),
          { id: 'preview-guest-missing' },
        )
      }, GUEST_READY_TIMEOUT_MS),
    )
  }

  // One stable ref callback per layer: an inline callback would detach and
  // re-attach on every render, recording the live frame as retired.
  const frameRefsRef = useRef(
    new Map<number, (element: HTMLIFrameElement | null) => () => void>(),
  )
  const frameRef = (id: number) => {
    let callback = frameRefsRef.current.get(id)
    if (!callback) {
      callback = (element) => {
        if (element) framesRef.current.set(id, element)
        const window = element?.contentWindow ?? null
        return () => {
          framesRef.current.delete(id)
          frameRefsRef.current.delete(id)
          if (window) retiredWindowsRef.current.add(window)
        }
      }
      frameRefsRef.current.set(id, callback)
    }
    return callback
  }

  const top = layers[layers.length - 1]
  return {
    layers,
    /** The incoming layer is in front and its guest is listening. */
    guestReady: top !== undefined && top.ready && top.guestReady,
    framesRef,
    activeFrameRef,
    retiredWindowsRef,
    markLayerReady,
    onFrameLoad,
    frameRef,
  }
}

export type PreviewLayers = ReturnType<typeof usePreviewLayers>
