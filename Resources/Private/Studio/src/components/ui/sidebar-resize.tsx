import { useCallback, useState } from 'react'

import { translate as t } from '@/lib/i18n'

const STORAGE_KEY = 'neos-studio.sidebar_width'
const MIN_WIDTH = 200
const MAX_WIDTH = 560
const DEFAULT_WIDTH = 256

function clamp(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))
}

/**
 * Drag-resizing for the shadcn Sidebar: pass `sidebarWidth` as
 * `--sidebar-width` on the SidebarProvider, render <SidebarResizeHandle>
 * inside <Sidebar> with the returned props, and suppress the sidebar's width
 * transitions while `isResizing`. The width persists across sessions.
 */
export function useResizableSidebar() {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem(STORAGE_KEY))
    return Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH
      ? stored
      : DEFAULT_WIDTH
  })
  const [isResizing, setIsResizing] = useState(false)

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    setIsResizing(true)

    let current: number | null = null
    const onMove = (ev: PointerEvent) => {
      // The sidebar is anchored to the left viewport edge, so the pointer's
      // x position IS the desired width.
      current = clamp(ev.clientX)
      setSidebarWidth(current)
    }
    const onUp = () => {
      setIsResizing(false)
      if (current !== null) localStorage.setItem(STORAGE_KEY, String(current))
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }, [])

  return { sidebarWidth, isResizing, resizeHandleProps: { onPointerDown } }
}

export function SidebarResizeHandle(props: {
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('common.resizeSidebar', 'Resize sidebar')}
      className="absolute inset-y-0 right-0 z-20 hidden w-1.5 cursor-col-resize transition-colors hover:bg-blue-500/40 active:bg-blue-500/60 md:block"
      {...props}
    />
  )
}
