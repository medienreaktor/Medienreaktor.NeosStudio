import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { Button } from '@/components/ui/button'
import { translate as t } from '@/lib/i18n'

/**
 * A pannable/zoomable graph viewport - the shared canvas behind the Node
 * Types and Workspaces panels. It owns the view transform (pointer pan,
 * wheel/pinch zoom towards the cursor, the zoom control cluster, fit-to-view)
 * and renders its children on a transformed surface; what the graph looks
 * like stays entirely with the caller.
 *
 * Interaction contract:
 * - One pointer gesture serves pan and click: below a small movement
 *   threshold it "picks" (reports the closest ancestor carrying a
 *   `data-graph-id` attribute at press time, or null on empty canvas),
 *   above it it pans. The pick target is remembered at press time because
 *   pointer capture retargets move/up events to the viewport.
 * - Wheel zoom is attached natively: React's synthetic wheel handlers cannot
 *   reliably preventDefault (passive listeners). Pinch gestures arrive as
 *   ctrl+wheel with small deltas and zoom faster.
 * - The canvas fits its content once, as soon as it is actually visible
 *   (panels mount hidden behind inactive tabs - a hidden tab's wrapper has
 *   zero width) AND the content has extents. `onVisible` fires at the same
 *   visibility edge, so callers can defer fetching until the panel is shown.
 */

export interface GraphCanvasHandle {
  fitToView(): void
  /** Center the view on a content rect, zooming in to at least `minScale`. */
  centerOnRect(
    rect: { x: number; y: number; width: number; height: number },
    minScale?: number,
  ): void
  zoomBy(factor: number): void
}

interface ViewTransform {
  x: number
  y: number
  scale: number
}

export interface GraphCanvasProps {
  /** Content extents, for fit-to-view. */
  contentWidth: number
  contentHeight: number
  minScale?: number
  maxScale?: number
  /** A non-drag click: the `data-graph-id` under the press, null on empty canvas. */
  onPick?: (id: string | null) => void
  /**
   * Fires on every visibility edge (true when the viewport gains real size,
   * false when it loses it - a panel behind an inactive tab has zero width).
   * Callers gate fetching and polling on this.
   */
  onVisibilityChange?: (visible: boolean) => void
  /** Untransformed overlays (search, legends) rendered above the canvas. */
  overlay?: React.ReactNode
  children: React.ReactNode
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(
  function GraphCanvas(
    {
      contentWidth,
      contentHeight,
      minScale = 0.08,
      maxScale = 2,
      onPick,
      onVisibilityChange,
      overlay,
      children,
    },
    ref,
  ) {
    const viewportRef = useRef<HTMLDivElement>(null)
    const [view, setView] = useState<ViewTransform>({ x: 40, y: 40, scale: 1 })
    const [visible, setVisible] = useState(false)

    const clampScale = (scale: number): number =>
      Math.min(maxScale, Math.max(minScale, scale))

    // Visibility via size: the hidden tab's wrapper has zero width.
    const onVisibilityChangeRef = useRef(onVisibilityChange)
    onVisibilityChangeRef.current = onVisibilityChange
    useEffect(() => {
      const element = viewportRef.current
      if (!element) return
      let last: boolean | null = null
      const observer = new ResizeObserver(() => {
        const now = element.clientWidth > 0
        if (now === last) return
        last = now
        if (now) setVisible(true)
        onVisibilityChangeRef.current?.(now)
      })
      observer.observe(element)
      return () => observer.disconnect()
    }, [])

    const fitToView = () => {
      const element = viewportRef.current
      if (!element || contentWidth === 0 || element.clientWidth === 0) return
      const padding = 40
      const scale = clampScale(
        Math.min(
          (element.clientWidth - padding * 2) / contentWidth,
          (element.clientHeight - padding * 2) / contentHeight,
          1,
        ),
      )
      setView({
        scale,
        x: (element.clientWidth - contentWidth * scale) / 2,
        y: (element.clientHeight - contentHeight * scale) / 2,
      })
    }

    // Fit once, as soon as both the content and a real viewport size exist.
    const fitted = useRef(false)
    useEffect(() => {
      if (fitted.current || !visible || contentWidth === 0) return
      fitted.current = true
      fitToView()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, contentWidth, contentHeight])

    // Wheel zoom towards the cursor, attached natively (see contract above).
    useEffect(() => {
      const element = viewportRef.current
      if (!element) return
      const onWheel = (event: WheelEvent) => {
        event.preventDefault()
        const rect = element.getBoundingClientRect()
        const cursorX = event.clientX - rect.left
        const cursorY = event.clientY - rect.top
        setView((current) => {
          const factor = Math.exp(
            -event.deltaY * (event.ctrlKey ? 0.01 : 0.0015),
          )
          const scale = clampScale(current.scale * factor)
          const ratio = scale / current.scale
          return {
            scale,
            x: cursorX - (cursorX - current.x) * ratio,
            y: cursorY - (cursorY - current.y) * ratio,
          }
        })
      }
      element.addEventListener('wheel', onWheel, { passive: false })
      return () => element.removeEventListener('wheel', onWheel)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [minScale, maxScale])

    const zoomBy = (factor: number) => {
      const element = viewportRef.current
      if (!element) return
      const centerX = element.clientWidth / 2
      const centerY = element.clientHeight / 2
      setView((current) => {
        const scale = clampScale(current.scale * factor)
        const ratio = scale / current.scale
        return {
          scale,
          x: centerX - (centerX - current.x) * ratio,
          y: centerY - (centerY - current.y) * ratio,
        }
      })
    }

    const centerOnRect = (
      rect: { x: number; y: number; width: number; height: number },
      centerMinScale = 0.5,
    ) => {
      const element = viewportRef.current
      if (!element) return
      setView((current) => {
        // Zoom in at least far enough that the centered rect is readable.
        const scale = clampScale(Math.max(current.scale, centerMinScale))
        return {
          scale,
          x: element.clientWidth / 2 - (rect.x + rect.width / 2) * scale,
          y: element.clientHeight / 2 - (rect.y + rect.height / 2) * scale,
        }
      })
    }

    useImperativeHandle(ref, () => ({ fitToView, centerOnRect, zoomBy }))

    const dragRef = useRef<{
      pointerId: number
      startX: number
      startY: number
      originX: number
      originY: number
      moved: boolean
      pressedId: string | null
    } | null>(null)

    const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement
      // Buttons and summary rows (collapsible toggles) must neither pan nor
      // change the pick.
      if (target.closest('button, input, a, summary')) return
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: view.x,
        originY: view.y,
        moved: false,
        pressedId:
          target.closest('[data-graph-id]')?.getAttribute('data-graph-id') ??
          null,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const deltaX = event.clientX - drag.startX
      const deltaY = event.clientY - drag.startY
      if (Math.abs(deltaX) + Math.abs(deltaY) > 3) drag.moved = true
      if (drag.moved) {
        setView((current) => ({
          ...current,
          x: drag.originX + deltaX,
          y: drag.originY + deltaY,
        }))
      }
    }

    const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      dragRef.current = null
      if (!drag.moved) onPick?.(drag.pressedId)
    }

    return (
      <div className="relative h-full min-h-0 overflow-hidden">
        {overlay}
        <div className="pointer-events-none absolute top-0 right-0 z-10 p-2">
          <div className="pointer-events-auto flex items-center gap-1 rounded-md bg-neutral-50/80 dark:bg-neutral-900/80 p-1 backdrop-blur-xs">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => zoomBy(1 / 1.25)}
              title={t('graph.zoomOut', 'Zoom out')}
            >
              <i className="fas fa-minus" aria-hidden />
            </Button>
            <span className="w-10 text-center text-[10px] text-neutral-600 dark:text-neutral-400 tabular-nums">
              {Math.round(view.scale * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => zoomBy(1.25)}
              title={t('graph.zoomIn', 'Zoom in')}
            >
              <i className="fas fa-plus" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={fitToView}
              title={t('graph.fit', 'Fit to view')}
            >
              <i className="fas fa-expand" aria-hidden />
            </Button>
          </div>
        </div>
        <div
          ref={viewportRef}
          className="h-full w-full cursor-grab touch-none overflow-hidden select-none active:cursor-grabbing"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(255, 255, 255, 0.07) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragRef.current = null
          }}
        >
          <div
            className="absolute top-0 left-0"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transformOrigin: '0 0',
            }}
          >
            {children}
          </div>
        </div>
      </div>
    )
  },
)
