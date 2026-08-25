import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { LoadingState } from '@/components/ui/spinner'
import { Placeholder } from '@/components/ui/placeholder'
import { config } from '@/config'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type {
  CompareGuestToHostMessage,
  CompareHostToGuestMessage,
  CompareMark,
  CompareMetrics,
} from './protocol'

/**
 * URL of one compare frame: the Studio preview of a node, rendered with the
 * edit-mode metadata markup (the aggregate ids the diff is drawn on) but
 * carrying the read-only compare script instead of the editing guest - see
 * PreviewController::showAction().
 */
export function compareUrl(address: string): string {
  const params = new URLSearchParams({
    node: address,
    mode: 'inPlace',
    compare: '1',
  })
  return `${config.previewBase}?${params}`
}

/** How long a frame may take to boot before it is called broken. */
const READY_TIMEOUT_MS = 15_000

export interface ComparePaneHandle {
  /** Scroll the rendered page; instant for sync, smooth for change jumps. */
  scrollTo: (scrollTop: number, smooth: boolean) => void
  /** Emphasize the marked element the change navigation sits on. */
  focus: (aggregateId: string | null) => void
}

/**
 * One side of the compare view: an iframe rendering a document in one
 * workspace, with the changed elements marked in it.
 *
 * The frame is same-origin and authenticated by the backend session (like the
 * editing preview), and it talks to this component over the compare protocol:
 * it reports where its content elements sit and where it is scrolled, and
 * takes the marks and scroll commands the compare view sends. Everything
 * cross-frame - pairing the two pages, translating one's scroll position into
 * the other's - happens above this component, which only ever knows its own
 * side.
 */
export const ComparePane = forwardRef<
  ComparePaneHandle,
  {
    /** Address to render, or null when the page does not exist on this side. */
    address: string | null
    marks: CompareMark[]
    /** The compared page itself - marked through its properties, see protocol. */
    documentAggregateId: string
    /** Shown instead of a frame when `address` is null. */
    emptyState: { icon: string; title: string }
    onMetrics: (metrics: CompareMetrics) => void
    /** The user scrolled this frame (echoes of our own scrolls are filtered). */
    onScroll: (scrollTop: number) => void
  }
>(function ComparePane(
  { address, marks, documentAggregateId, emptyState, onMetrics, onScroll },
  ref,
) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  // The v parameter (ignored by the server) makes every load's URL unique:
  // Safari answers repeated URLs from its HTTP cache, stale entries included -
  // the same reason the editing preview carries one.
  const src = useMemo(
    () => (address === null ? null : `${compareUrl(address)}&v=${Date.now()}`),
    [address],
  )

  // Latest-callback refs keep the message subscription stable across renders.
  const onMetricsRef = useRef(onMetrics)
  onMetricsRef.current = onMetrics
  const onScrollRef = useRef(onScroll)
  onScrollRef.current = onScroll

  const post = (message: CompareHostToGuestMessage) => {
    frameRef.current?.contentWindow?.postMessage(
      message,
      window.location.origin,
    )
  }

  useImperativeHandle(ref, () => ({
    scrollTo: (scrollTop: number, smooth: boolean) =>
      post({ type: 'neos-studio/compare-scroll-to', scrollTop, smooth }),
    focus: (aggregateId: string | null) =>
      post({ type: 'neos-studio/compare-focus', aggregateId }),
  }))

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      // Only this pane's own frame - the other one is posting the same
      // message types into the same window.
      if (event.source !== frameRef.current?.contentWindow) return
      const message = event.data as CompareGuestToHostMessage
      switch (message?.type) {
        case 'neos-studio/compare-ready':
          setReady(true)
          onMetricsRef.current(message.metrics)
          break
        case 'neos-studio/compare-metrics':
          onMetricsRef.current(message.metrics)
          break
        case 'neos-studio/compare-scroll':
          onScrollRef.current(message.scrollTop)
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // A new page is a new frame lifecycle.
  useEffect(() => {
    setReady(false)
    setFailed(false)
  }, [src])

  // A frame that never reports in is not rendering the page: the preview
  // answered 404 (the node is not readable in this workspace or dimension) or
  // failed outright - either way the response carries no compare script, so
  // no handshake can ever arrive and the pane says so instead of spinning
  // forever.
  useEffect(() => {
    if (src === null || ready) return
    const timer = setTimeout(() => setFailed(true), READY_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [src, ready])

  // Push the marks once the frame is up, and again whenever they change (a
  // refetched diff, another document).
  useEffect(() => {
    if (!ready) return
    post({ type: 'neos-studio/compare-marks', marks, documentAggregateId })
    // post reads the frame ref - stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, marks, documentAggregateId])

  if (src === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-neutral-100 dark:bg-neutral-900">
        <Placeholder icon={emptyState.icon} title={emptyState.title} />
      </div>
    )
  }

  return (
    <div className="relative min-h-0 flex-1 bg-white">
      <iframe
        ref={frameRef}
        src={src}
        title={t('compare.frameTitle', 'Page version')}
        className={cn(
          'absolute inset-0 h-full w-full border-0 transition-opacity duration-100',
          ready ? 'opacity-100' : 'opacity-0',
        )}
      />
      {!ready && (
        <div className="absolute inset-0 flex bg-neutral-100 dark:bg-neutral-900">
          {failed ? (
            <Placeholder
              icon="fa-triangle-exclamation"
              title={t(
                'compare.frameFailed',
                'This version of the page could not be rendered.',
              )}
            />
          ) : (
            <LoadingState label={t('compare.frameLoading', 'Rendering…')} />
          )}
        </div>
      )}
    </div>
  )
})
