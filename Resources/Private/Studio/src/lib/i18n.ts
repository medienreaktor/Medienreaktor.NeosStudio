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
 *
 * The Studio's own UI strings live under the "Medienreaktor.NeosStudio:Main"
 * source; `translate()` (and its `useTranslate` hook) default to that source,
 * so call sites pass just the trans-unit id plus the English source text as a
 * fallback - see Resources/Private/Translations.
 */

/** Values are plain strings or plural forms (an array, singular first). */
type TranslationValue = string | string[]
type XliffBundle = Record<
  string,
  Record<string, Record<string, TranslationValue>>
>

/** The source the Studio keeps its own UI strings in. */
const STUDIO_PACKAGE = 'Medienreaktor.NeosStudio'
const STUDIO_SOURCE = 'Main'

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

/** The translation for a fully-qualified label id, or null when unknown. */
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

/** Positional ({0}, {1}, ...) or named ({name}) interpolation arguments. */
export type TranslateArgs =
  Array<string | number> | Record<string, string | number>

/** Replace {0}/{1}/... or {name} placeholders, mirroring Neos i18n. */
function interpolate(text: string, args?: TranslateArgs): string {
  if (!args) return text
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = Array.isArray(args)
      ? args[Number(key)]
      : (args as Record<string, string | number>)[key]
    return value === undefined ? match : String(value)
  })
}

/**
 * Translate a Studio UI string.
 *
 * @param id       Either a bare trans-unit id resolved against
 *                 "Medienreaktor.NeosStudio:Main" (the common case), or a
 *                 fully-qualified "Package:Source:id" to reuse a core label.
 * @param fallback English source text shown when the bundle is missing the id
 *                 (also the value used before the bundle finishes loading).
 * @param args     Optional placeholder values.
 */
export function translate(
  id: string,
  fallback?: string,
  args?: TranslateArgs,
): string {
  const label = id.includes(':')
    ? id
    : `${STUDIO_PACKAGE}:${STUDIO_SOURCE}:${id}`
  const translated = translateLabel(label)
  return interpolate(translated ?? fallback ?? id, args)
}

/**
 * Hook form of {@link translate}. The interface language is fixed for the
 * lifetime of the shell (changing it reloads the page), so this simply hands
 * back the stable `translate` function - the hook exists for call-site
 * ergonomics and so components read as translation-aware.
 */
export function useTranslate(): typeof translate {
  return translate
}
