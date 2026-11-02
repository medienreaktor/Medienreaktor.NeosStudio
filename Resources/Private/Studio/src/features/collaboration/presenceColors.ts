/**
 * Stable per-user colors and initials for presence indicators (avatars, tree
 * markers, guest outlines). The palette is the Presence/1-7 tokens of the
 * Studio design file; it avoids the selection blue and the dirty-marker
 * orange so presence never reads as selection or pending changes, and every
 * entry carries text-presence-foreground.
 */
const PRESENCE_PALETTE = [1, 2, 3, 4, 5, 6, 7].map(
  (n) => `var(--color-presence-${n})`,
)

/** Deterministic palette pick per user id - the same user gets the same
 * color on every client without any coordination. */
export function presenceColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0
  }
  // The modulo keeps the index within the (non-empty) palette.
  return PRESENCE_PALETTE[Math.abs(hash) % PRESENCE_PALETTE.length]!
}

/**
 * The same color as a concrete value, for consumers outside the shell's
 * stylesheet - the guest frame renders the site, where Studio's custom
 * properties do not exist.
 */
export function presenceColorValue(userId: string): string {
  const token = presenceColor(userId).slice(4, -1)
  return getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim()
}

/** "Jane Doe" -> "JD"; single names give one letter, empty names "?". */
export function presenceInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0]?.[0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase() || '?'
}
