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
    background: `color-mix(in srgb, ${color} ${tint}%, var(--color-card))`,
  }
}

/** The selected card: offset ring plus glow - unmistakable on the canvas. */
export const SELECTED_RING =
  'ring-2 ring-ring ring-offset-2 ring-offset-background shadow-lg shadow-primary/40'
