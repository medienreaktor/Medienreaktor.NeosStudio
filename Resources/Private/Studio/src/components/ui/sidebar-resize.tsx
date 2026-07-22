import { useCallback, useState } from 'react'

import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'neos-studio.sidebar_width'
const MIN_WIDTH = 200
const MAX_WIDTH = 560
const DEFAULT_WIDTH = 300

function clamp(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))
}

/**
 * Drag-resizing for a viewport-edge-anchored sidebar. For the shadcn Sidebar:
 * pass `sidebarWidth` as `--sidebar-width` on the SidebarProvider, render
 * <SidebarResizeHandle> inside <Sidebar> with the returned props, and suppress
 * the sidebar's width transitions while `isResizing`. The width persists
 * across sessions under `storageKey`.
 *
 * `side` is the viewport edge the sidebar is anchored to; the resize handle
 * sits on its opposite (inner) edge.
 */
export function useResizableSidebar({
  storageKey = STORAGE_KEY,
  defaultWidth = DEFAULT_WIDTH,
  side = 'left',
}: {
  storageKey?: string
  defaultWidth?: number
  side?: 'left' | 'right'
} = {}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem(storageKey))
    return Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH
      ? stored
      : defaultWidth
  })
  const [isResizing, setIsResizing] = useState(false)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const handle = e.currentTarget
      handle.setPointerCapture(e.pointerId)
      setIsResizing(true)

      let current: number | null = null
      const onMove = (ev: PointerEvent) => {
        // The sidebar is anchored to a viewport edge, so the width is the
        // pointer's distance from that edge.
        current = clamp(
          side === 'left' ? ev.clientX : window.innerWidth - ev.clientX,
        )
        setSidebarWidth(current)
      }
      const onUp = () => {
        setIsResizing(false)
        if (current !== null) localStorage.setItem(storageKey, String(current))
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
    },
    [storageKey, side],
  )

  return { sidebarWidth, isResizing, resizeHandleProps: { onPointerDown } }
}

export function SidebarResizeHandle({
  side = 'left',
  ...props
}: {
  side?: 'left' | 'right'
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('common.resizeSidebar', 'Resize sidebar')}
      className={cn(
        'absolute inset-y-0 z-20 hidden w-1.5 cursor-col-resize transition-colors hover:bg-blue-500/40 active:bg-blue-500/60 md:block',
        side === 'left' ? 'right-0' : 'left-0',
      )}
      {...props}
    />
  )
}
