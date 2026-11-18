/**
 * The text of a computed `content` value: its first string, with CSS escapes
 * resolved. Browsers differ in whether `var(--fa)` arrives escaped
 * ("\f017") or as the character itself.
 */
export function glyphOf(content: string): string | null {
  const match = /^\s*(["'])((?:\\.|(?!\1).)*)\1/su.exec(content)
  const text = match?.[2]
  if (!text) return null
  return text.replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/gsu, (_, hex, char) =>
    hex ? String.fromCodePoint(parseInt(hex as string, 16)) : (char as string),
  )
}
