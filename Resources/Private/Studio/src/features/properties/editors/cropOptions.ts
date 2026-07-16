/**
 * Parses the image editor's crop configuration out of its editorOptions. The
 * shape mirrors the classic Neos ImageEditor (ui.inspector.editorOptions):
 *
 *   features:
 *     crop: true                 # enable the crop tool (default true)
 *   crop:
 *     aspectRatio:
 *       locked: { width, height } # hard-lock one ratio; hides the selector
 *       options:                  # named presets, in order
 *         square: { width: 1, height: 1, label: 'Square' }
 *         wide:   { width: 16, height: 9 }
 *       enableOriginal: true      # offer the image's own ratio
 *       allowCustom: true         # offer a free (unconstrained) crop
 *       defaultOption: 'square'   # preset preselected for an uncropped image
 *
 * Anything missing degrades sensibly: with no presets and no lock the tool
 * still opens with a free crop, so a bare `ImageEditor` can crop too.
 */

/** One configured aspect-ratio preset. */
export interface AspectRatioPreset {
  id: string
  label: string
  width: number
  height: number
}

/** The crop tool's resolved configuration for one image property. */
export interface CropConfig {
  /** Whether the crop tool is offered at all (features.crop, default true). */
  enabled: boolean
  /** A hard-locked ratio; when set the selector is hidden and this is enforced. */
  locked: { width: number; height: number } | null
  /** Configured presets, in configuration order. */
  presets: AspectRatioPreset[]
  /** Offer the original image's own aspect ratio. */
  allowOriginal: boolean
  /** Offer a free, unconstrained crop. */
  allowCustom: boolean
  /** Preset id preselected when the image has no crop yet. */
  defaultOption: string | null
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function positiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

function ratioLabel(label: unknown, width: number, height: number): string {
  return typeof label === 'string' && label.trim() !== ''
    ? label
    : `${width}:${height}`
}

/** Parse crop configuration out of an image editor's editorOptions. */
export function parseCropConfig(options: Record<string, unknown>): CropConfig {
  const features = record(options.features)
  // Only an explicit `false` disables the tool; absent means enabled.
  const enabled = features?.crop !== false

  const aspectRatio = record(record(options.crop)?.aspectRatio)

  let locked: CropConfig['locked'] = null
  const lockedConfig = record(aspectRatio?.locked)
  if (lockedConfig) {
    const width = positiveInt(lockedConfig.width)
    const height = positiveInt(lockedConfig.height)
    if (width && height) locked = { width, height }
  }

  const presets: AspectRatioPreset[] = []
  const optionsConfig = record(aspectRatio?.options)
  if (optionsConfig) {
    for (const [id, raw] of Object.entries(optionsConfig)) {
      // A null entry disables a preset inherited from a supertype.
      const preset = record(raw)
      if (!preset) continue
      const width = positiveInt(preset.width)
      const height = positiveInt(preset.height)
      if (!width || !height) continue
      presets.push({
        id,
        label: ratioLabel(preset.label, width, height),
        width,
        height,
      })
    }
  }

  // The docs use `enableOriginal`; the classic runtime read `allowOriginal`.
  // Honour either spelling.
  const allowOriginal =
    aspectRatio?.enableOriginal === true || aspectRatio?.allowOriginal === true
  const allowCustom = aspectRatio?.allowCustom === true
  const defaultOption =
    typeof aspectRatio?.defaultOption === 'string'
      ? aspectRatio.defaultOption
      : null

  return { enabled, locked, presets, allowOriginal, allowCustom, defaultOption }
}
