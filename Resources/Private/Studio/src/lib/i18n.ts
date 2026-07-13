import { config } from '@/config'

/**
 * Translation of Neos i18n label ids ("Package:Source:trans.unit.id"), fed
 * by the same XLIFF-as-JSON endpoint the classic UI uses. The bundle is
 * loaded once at boot (App awaits it before first paint, browser-cached for
 * a week) into a module-level store, so label resolution stays a plain
 * synchronous function usable from non-hook code like the inspector schema
 * builders. A missing bundle or label degrades to the humanized fallback.
 *
 * The lookup mirrors the classic UI's TranslationRepository: the endpoint
 * nests translations as bundle[package][source][id] with every dot (and
 * slashes in source file paths) replaced by underscores.
 */

/** Values are plain strings or plural forms (an array, singular first). */
type TranslationValue = string | string[]
type XliffBundle = Record<string, Record<string, Record<string, TranslationValue>>>

let bundle: XliffBundle | null = null

/** Session-authenticated (same-origin cookie), NOT an API request. */
export async function loadTranslations(): Promise<void> {
  try {
    const response = await fetch(
      `${config.xliffEndpoint}?locale=${encodeURIComponent(config.interfaceLanguage)}`,
      { credentials: 'include' },
    )
    if (response.ok) bundle = (await response.json()) as XliffBundle
  } catch {
    /* an untranslated UI beats a broken shell */
  }
}

/** The translation for a label id, or null when unknown/untranslated. */
export function translateLabel(label: string): string | null {
  if (bundle === null) return null
  const parts = label.split(':')
  if (parts.length < 3) return null
  const [packageKey, sourceName, ...idParts] = parts
  const value =
    bundle[packageKey.replace(/\./g, '_')]?.[sourceName.replace(/\./g, '_')]?.[
      idParts.join(':').replace(/\./g, '_')
    ]
  if (typeof value === 'string') return value
  // Plural forms - the singular serves as the label.
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return null
}
