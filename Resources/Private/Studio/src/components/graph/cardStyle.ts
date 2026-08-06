import type { CSSProperties } from 'react'

/**
 * The shared look of cards on a GraphCanvas (node types, workspaces): the
 * category/branch color carries the card as a solid outline plus a subtle
 * tint of the surface - no decorative accent bars. Selection is a separate,
 * deliberately loud treatment so it stays visible at any zoom level.
 */

/** Solid outline + tinted surface in the card's color. `tint` in percent. */
export function cardSurface(color: string, tint = 10): CSSProperties {
  return {
    borderColor: color,
    background: `color-mix(in srgb, ${color} ${tint}%, light-dark(var(--color-neutral-100), var(--color-neutral-900)))`,
  }
}

/** The selected card: offset ring plus glow - unmistakable on the canvas. */
export const SELECTED_RING =
  'ring-2 ring-blue-500 ring-offset-2 ring-offset-neutral-50 dark:ring-offset-neutral-950 shadow-lg shadow-blue-500/40'
