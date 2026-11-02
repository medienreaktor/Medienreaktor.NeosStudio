/**
 * Lengths JavaScript computes with - graph geometry, panel and sidebar limits -
 * are written in rem like the CSS, so they scale with the reader's default font
 * size together with the text they hold. `rem()` turns one into the px value
 * layout code and SVG attributes need.
 *
 * The root font size is read once: browsers apply a changed default font size
 * on reload, and reading it per call would put a style recalculation into every
 * layout loop.
 */
let rootFontSize: number | undefined

export function rem(value: number): number {
  rootFontSize ??=
    parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  return value * rootFontSize
}
