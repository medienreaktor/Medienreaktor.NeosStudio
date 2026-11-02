/**
 * Studio's lengths are rem: in CSS, and in JavaScript as plain numbers meaning
 * rem, rendered as `${value}rem`. Everything then scales with the root font
 * size - the reader's default font size, which browsers apply to open pages
 * live - without JavaScript having to notice.
 *
 * Pixels only exist where code reads the screen: pointer positions, scroll
 * offsets, element and window sizes. These helpers convert at that boundary,
 * reading the root font size fresh every time, because it can change at any
 * moment.
 */
export function rootFontSize(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
}

export function pxToRem(px: number): number {
  return px / rootFontSize()
}

export function remToPx(rem: number): number {
  return rem * rootFontSize()
}
