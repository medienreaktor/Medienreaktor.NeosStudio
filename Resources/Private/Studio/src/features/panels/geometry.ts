/**
 * Shared geometry for floating panel groups: viewport clamping and
 * edge/corner resizing.
 */

export type PanelRect = { x: number; y: number; width: number; height: number }

export const MIN_WIDTH = 240
export const MIN_HEIGHT = 160
export const VIEWPORT_MARGIN = 8

export function clampToViewport(rect: PanelRect): PanelRect {
  const width = Math.min(Math.max(rect.width, MIN_WIDTH), window.innerWidth - VIEWPORT_MARGIN * 2)
  const height = Math.min(Math.max(rect.height, MIN_HEIGHT), window.innerHeight - VIEWPORT_MARGIN * 2)
  return {
    width,
    height,
    x: Math.min(Math.max(rect.x, VIEWPORT_MARGIN), window.innerWidth - width - VIEWPORT_MARGIN),
    y: Math.min(Math.max(rect.y, VIEWPORT_MARGIN), window.innerHeight - height - VIEWPORT_MARGIN),
  }
}

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const RESIZE_HANDLES: Array<{ direction: ResizeDirection; className: string }> = [
  { direction: 'n', className: 'inset-x-2 -top-1 h-2 cursor-n-resize' },
  { direction: 's', className: 'inset-x-2 -bottom-1 h-2 cursor-s-resize' },
  { direction: 'e', className: 'inset-y-2 -right-1 w-2 cursor-e-resize' },
  { direction: 'w', className: 'inset-y-2 -left-1 w-2 cursor-w-resize' },
  { direction: 'ne', className: '-top-1 -right-1 size-3 cursor-ne-resize' },
  { direction: 'nw', className: '-top-1 -left-1 size-3 cursor-nw-resize' },
  { direction: 'se', className: '-bottom-1 -right-1 size-3 cursor-se-resize' },
  { direction: 'sw', className: '-bottom-1 -left-1 size-3 cursor-sw-resize' },
]

/** The rect after dragging the given edge/corner by (dx, dy). */
export function resizeRect(start: PanelRect, direction: ResizeDirection, dx: number, dy: number): PanelRect {
  let { x, y, width, height } = start
  if (direction.includes('e')) width = start.width + dx
  if (direction.includes('s')) height = start.height + dy
  if (direction.includes('w')) width = start.width - dx
  if (direction.includes('n')) height = start.height - dy
  width = Math.min(Math.max(width, MIN_WIDTH), window.innerWidth - VIEWPORT_MARGIN * 2)
  height = Math.min(Math.max(height, MIN_HEIGHT), window.innerHeight - VIEWPORT_MARGIN * 2)
  // Resizing from the west/north edge moves the origin so the opposite edge
  // stays anchored.
  if (direction.includes('w')) x = start.x + start.width - width
  if (direction.includes('n')) y = start.y + start.height - height
  return clampToViewport({ x, y, width, height })
}
