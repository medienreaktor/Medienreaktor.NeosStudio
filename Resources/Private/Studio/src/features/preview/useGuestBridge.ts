import { useCallback, useEffect, useRef } from 'react'
import { useLatestRef } from '@/hooks/use-latest-ref'
import { translate as t } from '@/lib/i18n'
import {
  type GuestToHostMessage,
  type HostToGuestMessage,
  isGuestToHostMessage,
} from './protocol'
import type { PreviewLayers } from './usePreviewLayers'

/** How long the host waits for a retiring frame to confirm its flush. */
const FLUSH_TIMEOUT_MS = 1000

/**
 * Messages accepted from any of the Studio's frames, not just the active one:
 * the handshake of an incoming frame, replies to requests (a frame can retire
 * while its answer is under way), and persistence - edits flushed by a frame
 * that is being retired or already gone must still be saved.
 */
const ACCEPTED_FROM_ANY_FRAME: ReadonlySet<GuestToHostMessage['type']> =
  new Set([
    'neos-studio/guest-ready',
    'neos-studio/property-changed',
    'neos-studio/element-info',
    'neos-studio/element-replaced',
    'neos-studio/flushed',
  ])

type ReplyType =
  | 'neos-studio/element-info'
  | 'neos-studio/element-replaced'
  | 'neos-studio/flushed'

/** A host request: its message, built around the requestId it gets. */
type GuestRequest = Extract<HostToGuestMessage, { requestId: number }>

/**
 * The postMessage bridge between PreviewPane and the guests of its frames.
 * Verifies every incoming message - same origin, sent by one of the preview
 * frames, well-formed (isGuestToHostMessage) - answers the handshake,
 * resolves replies to requests the host sent, and hands everything else to
 * `onMessage`. Interactive messages (selection, menus, requests) are only
 * taken from the active frame; a background frame on its way out has no say
 * any more (see ACCEPTED_FROM_ANY_FRAME for the exceptions).
 */
export function useGuestBridge({
  layers,
  onMessage,
}: {
  layers: Pick<
    PreviewLayers,
    'framesRef' | 'activeFrameRef' | 'retiredWindowsRef' | 'markLayerReady'
  >
  onMessage: (message: GuestToHostMessage) => void
}) {
  const { framesRef, activeFrameRef, retiredWindowsRef, markLayerReady } =
    layers
  // Latest-callback ref keeps the message listener subscription stable.
  const onMessageRef = useLatestRef(onMessage)
  const markLayerReadyRef = useLatestRef(markLayerReady)

  // Replies to requests the shell sent into a guest, resolved by requestId.
  const pendingRepliesRef = useRef(
    new Map<number, (message: GuestToHostMessage) => void>(),
  )
  const nextRequestIdRef = useRef(0)

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      // Only messages from one of our preview frames are trusted - live, or
      // retired but still flushing.
      let sourceId: number | null = null
      for (const [id, frame] of framesRef.current) {
        if (frame.contentWindow === event.source) {
          sourceId = id
          break
        }
      }
      const retired =
        sourceId === null &&
        event.source !== null &&
        retiredWindowsRef.current.has(event.source as Window)
      if (sourceId === null && !retired) return
      // Site scripts share the guest's window and could post as well - act
      // only on well-formed messages.
      const message: unknown = event.data
      if (!isGuestToHostMessage(message)) return
      const active =
        sourceId !== null &&
        framesRef.current.get(sourceId) === activeFrameRef.current
      if (!active && !ACCEPTED_FROM_ANY_FRAME.has(message.type)) return

      switch (message.type) {
        case 'neos-studio/guest-ready': {
          if (sourceId === null) return
          markLayerReadyRef.current(sourceId, true)
          // The guest's UI strings, translated for it (it has no bundle of
          // its own): unknown ids keep the English fallback it sent.
          const labels: Record<string, string> = {}
          for (const [key, fallback] of Object.entries(message.labels)) {
            if (typeof fallback === 'string')
              labels[key] = t(`guest.${key}`, fallback)
          }
          const init: HostToGuestMessage = { type: 'neos-studio/init', labels }
          ;(event.source as Window).postMessage(init, window.location.origin)
          return
        }
        case 'neos-studio/element-info':
        case 'neos-studio/element-replaced':
        case 'neos-studio/flushed':
          pendingRepliesRef.current.get(message.requestId)?.(message)
          return
        default:
          onMessageRef.current(message)
      }
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [
    framesRef,
    activeFrameRef,
    retiredWindowsRef,
    onMessageRef,
    markLayerReadyRef,
  ]) // all stable refs

  /**
   * Post to the active frame's guest (no-op without one). Stable - it only
   * reads the frame ref - so effects can list it without re-running.
   */
  const postToGuest = useCallback(
    (message: HostToGuestMessage) => {
      activeFrameRef.current?.contentWindow?.postMessage(
        message,
        window.location.origin,
      )
    },
    [activeFrameRef],
  )

  /**
   * Send a request into a frame (the active one by default) and wait for its
   * reply of `replyType`; null when none arrives within `timeoutMs`.
   */
  const request = <Type extends ReplyType>(
    build: (requestId: number) => GuestRequest,
    replyType: Type,
    timeoutMs: number,
    frame: Window | null = activeFrameRef.current?.contentWindow ?? null,
  ): Promise<Extract<GuestToHostMessage, { type: Type }> | null> => {
    if (frame === null) return Promise.resolve(null)
    const requestId = ++nextRequestIdRef.current
    return new Promise((resolve) => {
      const pending = pendingRepliesRef.current
      const timer = setTimeout(() => {
        pending.delete(requestId)
        resolve(null)
      }, timeoutMs)
      pending.set(requestId, (reply) => {
        clearTimeout(timer)
        pending.delete(requestId)
        resolve(
          reply.type === replyType
            ? (reply as Extract<GuestToHostMessage, { type: Type }>)
            : null,
        )
      })
      frame.postMessage(build(requestId), window.location.origin)
    })
  }

  /**
   * Have a frame's guest post its pending inline edits; settles once it
   * confirmed, or after FLUSH_TIMEOUT_MS without an answer.
   */
  const flush = async (frame: Window): Promise<void> => {
    await request(
      (requestId) => ({ type: 'neos-studio/flush', requestId }),
      'neos-studio/flushed',
      FLUSH_TIMEOUT_MS,
      frame,
    )
  }

  return { postToGuest, request, flush }
}
