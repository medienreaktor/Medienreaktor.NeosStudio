import type * as React from 'react'
import { pxToRem } from '@/lib/rem'

/**
 * Shared geometry for floating panel groups: viewport clamping and
 * edge/corner resizing.
 *
 * A rect is in rem, like every length in Studio (see lib/rem.ts), so a panel
 * keeps its proportion to the text it holds when the root font size changes.
 * Only the viewport size and pointer movements arrive in px; they are
 * converted where they are read.
 */

export type PanelRect = { x: number; y: number; width: number; height: number }

export const MIN_WIDTH = 15
export const MIN_HEIGHT = 10
export const VIEWPORT_MARGIN = 0.5

export function clampToViewport(rect: PanelRect): PanelRect {
  const viewportWidth = pxToRem(window.innerWidth)
  const viewportHeight = pxToRem(window.innerHeight)
  const width = Math.min(
    Math.max(rect.width, MIN_WIDTH),
    viewportWidth - VIEWPORT_MARGIN * 2,
  )
  const height = Math.min(
    Math.max(rect.height, MIN_HEIGHT),
    viewportHeight - VIEWPORT_MARGIN * 2,
  )
  return {
    width,
    height,
    x: Math.min(
      Math.max(rect.x, VIEWPORT_MARGIN),
      viewportWidth - width - VIEWPORT_MARGIN,
    ),
    y: Math.min(
      Math.max(rect.y, VIEWPORT_MARGIN),
      viewportHeight - height - VIEWPORT_MARGIN,
    ),
  }
}

/**
 * The rect as CSS, clamped to the viewport once more at render time. The
 * stored rect is clamped whenever it changes and on window resize, but a
 * changed root font size grows every rem without either happening; this
 * keeps the panel on screen until the next interaction clamps it for real.
 */
export function floatingRectStyle(
  rect: PanelRect,
  collapsed: boolean,
): React.CSSProperties {
  const margin = `${VIEWPORT_MARGIN}rem`
  const width = `min(${rect.width}rem, 100vw - 2 * ${margin})`
  const height = `min(${rect.height}rem, 100dvh - 2 * ${margin})`
  return {
    left: `clamp(${margin}, ${rect.x}rem, 100vw - ${width} - ${margin})`,
    top: `clamp(${margin}, ${rect.y}rem, 100dvh - ${height} - ${margin})`,
    width,
    height: collapsed ? undefined : height,
  }
}

/** A rect measured on screen, in px, as a panel rect. */
export function rectFromPx(rect: PanelRect): PanelRect {
  return {
    x: pxToRem(rect.x),
    y: pxToRem(rect.y),
    width: pxToRem(rect.width),
    height: pxToRem(rect.height),
  }
}

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const RESIZE_HANDLES: Array<{
  direction: ResizeDirection
  className: string
}> = [
  { direction: 'n', className: 'inset-x-2 -top-1 h-2 cursor-n-resize' },
  { direction: 's', className: 'inset-x-2 -bottom-1 h-2 cursor-s-resize' },
  { direction: 'e', className: 'inset-y-2 -right-1 w-2 cursor-e-resize' },
  { direction: 'w', className: 'inset-y-2 -left-1 w-2 cursor-w-resize' },
  { direction: 'ne', className: '-top-1 -right-1 size-3 cursor-ne-resize' },
  { direction: 'nw', className: '-top-1 -left-1 size-3 cursor-nw-resize' },
  { direction: 'se', className: '-bottom-1 -right-1 size-3 cursor-se-resize' },
  { direction: 'sw', className: '-bottom-1 -left-1 size-3 cursor-sw-resize' },
]

/** The rect after dragging the given edge/corner by (dx, dy), in rem. */
export function resizeRect(
  start: PanelRect,
  direction: ResizeDirection,
  dx: number,
  dy: number,
): PanelRect {
  let { x, y, width, height } = start
  if (direction.includes('e')) width = start.width + dx
  if (direction.includes('s')) height = start.height + dy
  if (direction.includes('w')) width = start.width - dx
  if (direction.includes('n')) height = start.height - dy
  width = Math.min(
    Math.max(width, MIN_WIDTH),
    pxToRem(window.innerWidth) - VIEWPORT_MARGIN * 2,
  )
  height = Math.min(
    Math.max(height, MIN_HEIGHT),
    pxToRem(window.innerHeight) - VIEWPORT_MARGIN * 2,
  )
  // Resizing from the west/north edge moves the origin so the opposite edge
  // stays anchored.
  if (direction.includes('w')) x = start.x + start.width - width
  if (direction.includes('n')) y = start.y + start.height - height
  return clampToViewport({ x, y, width, height })
}
