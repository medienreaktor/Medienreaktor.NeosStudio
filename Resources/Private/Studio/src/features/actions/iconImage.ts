import { faClassName } from '@/components/ui/icon'
import { glyphOf } from './glyph'

/** Drawn this large so the glyph stays crisp when scaled down on high-density screens. */
const SIZE = 64

const images = new Map<string, Promise<string | null>>()

/**
 * A Font Awesome icon drawn into a PNG data URL, for a document without the
 * shell's icon font (the preview frame, whose page loads only its own
 * styles). Resolved through the shell's stylesheet like `ui.icon`, so every
 * name the shell renders works. Null when the name resolves to no glyph.
 */
export function iconImage(icon: string): Promise<string | null> {
  let image = images.get(icon)
  if (!image) {
    image = draw(icon).catch(() => null)
    images.set(icon, image)
  }
  return image
}

async function draw(icon: string): Promise<string | null> {
  const probe = document.createElement('i')
  probe.className = faClassName(icon)
  probe.setAttribute('aria-hidden', 'true')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  document.body.appendChild(probe)
  let glyph: string | null
  let font: string
  try {
    const style = getComputedStyle(probe)
    glyph = glyphOf(getComputedStyle(probe, '::before').content)
    font = `${style.fontWeight} ${SIZE * 0.8}px ${style.fontFamily}`
  } finally {
    probe.remove()
  }
  if (!glyph) return null
  // The webfonts load lazily, on the first glyph the shell renders in them.
  await document.fonts.load(font, glyph)
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const context = canvas.getContext('2d')
  if (!context) return null
  context.font = font
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'
  const metrics = context.measureText(glyph)
  const top = metrics.actualBoundingBoxAscent
  const height = top + metrics.actualBoundingBoxDescent
  context.fillText(glyph, SIZE / 2, (SIZE - height) / 2 + top)
  return canvas.toDataURL('image/png')
}
