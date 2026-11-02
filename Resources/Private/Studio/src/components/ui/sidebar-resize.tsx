import { useCallback, useState } from 'react'

import { translate as t } from '@/lib/i18n'
import { pxToRem } from '@/lib/rem'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'neos-studio.sidebar_width'
/** Widths are rem, like every length in Studio (see lib/rem.ts). */
const MIN_WIDTH = 12.5
const MAX_WIDTH = 35
const DEFAULT_WIDTH = 18.75

function clamp(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))
}

/**
 * A stored width: "20rem", or a bare number from when widths were px, which
 * divided by 16 keeps the sidebar's size at the default root.
 */
function readStoredWidth(value: string | null): number | null {
  if (value === null || value === '') return null
  const width = value.endsWith('rem') ? parseFloat(value) : Number(value) / 16
  return Number.isFinite(width) && width >= MIN_WIDTH && width <= MAX_WIDTH
    ? width
    : null
}

/**
 * Drag-resizing for a viewport-edge-anchored sidebar. `sidebarWidth` is in
 * rem. For the shadcn Sidebar: pass it as `--sidebar-width` on the
 * SidebarProvider, render
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
  const [sidebarWidth, setSidebarWidth] = useState(
    () => readStoredWidth(localStorage.getItem(storageKey)) ?? defaultWidth,
  )
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
        // pointer's distance from that edge - px, converted.
        current = clamp(
          pxToRem(
            side === 'left' ? ev.clientX : window.innerWidth - ev.clientX,
          ),
        )
        setSidebarWidth(current)
      }
      const onUp = () => {
        setIsResizing(false)
        if (current !== null) localStorage.setItem(storageKey, `${current}rem`)
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
        'absolute inset-y-0 z-20 hidden w-1.5 cursor-col-resize transition-colors hover:bg-primary/40 active:bg-primary/60 md:block',
        side === 'left' ? 'right-0' : 'left-0',
      )}
      {...props}
    />
  )
}
