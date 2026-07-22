/**
 * Stable per-user colors and initials for presence indicators (avatars, tree
 * markers, guest outlines). The palette avoids the shell's selection blue
 * (#00adee) and the dirty-marker orange so presence never reads as selection
 * or pending changes; every entry carries white text at small sizes.
 */
const PRESENCE_PALETTE = [
  '#7161c0', // purple
  '#e04b64', // raspberry
  '#00a338', // green
  '#c2571c', // rust
  '#12939e', // teal
  '#b44bd3', // orchid
  '#5c7cfa', // indigo
]

/** Deterministic palette pick per user id - the same user gets the same
 * color on every client without any coordination. */
export function presenceColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0
  }
  return PRESENCE_PALETTE[Math.abs(hash) % PRESENCE_PALETTE.length]
}

/** "Jane Doe" -> "JD"; single names give one letter, empty names "?". */
export function presenceInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0][0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase() || '?'
}
