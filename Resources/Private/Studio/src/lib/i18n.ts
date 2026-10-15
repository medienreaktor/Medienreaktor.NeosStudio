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
 * source; `translate()` and `translatePlural()` default to that source, so
 * call sites pass just the trans-unit id plus the English source text as a
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
      `${config.xliffEndpoint}?locale=${encodeURIComponent(config.interfaceLanguage)}${
        config.xliffVersion
          ? `&version=${encodeURIComponent(config.xliffVersion)}`
          : ''
      }`,
      { credentials: 'include' },
    )
    if (response.ok) bundle = (await response.json()) as XliffBundle
  } catch {
    /* an untranslated UI beats a broken shell */
  }
}

/** The raw bundle entry for a fully-qualified label id. */
function translationValue(label: string): TranslationValue | undefined {
  if (bundle === null) return undefined
  const [packageKey, sourceName, ...idParts] = label.split(':')
  if (packageKey === undefined || sourceName === undefined) return undefined
  if (idParts.length === 0) return undefined
  return bundle[packageKey.replace(/\./g, '_')]?.[
    sourceName.replace(/\./g, '_')
  ]?.[idParts.join(':').replace(/\./g, '_')]
}

/** The translation for a fully-qualified label id, or null when unknown. */
export function translateLabel(label: string): string | null {
  const value = translationValue(label)
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
 * Translate a Studio UI string that depends on a count - "1 site" vs "3
 * sites".
 *
 * The catalogue holds such a string as a plural group, the way Flow does
 * (`<group restype="x-gettext-plurals">` with trans-units "id[0]", "id[1]",
 * ...), which the XLIFF endpoint hands over as an array of forms. The forms
 * follow the CLDR plural categories the locale has, in CLDR order (zero, one,
 * two, few, many, other): English and German have one/other, Polish
 * one/few/many/other. The count picks the category, the category the form;
 * a catalogue that still has a single string uses it for every count.
 *
 * `{0}` is the count; further args continue at `{1}`.
 *
 * @param fallback English [singular, plural], used without a bundle entry.
 */
export function translatePlural(
  id: string,
  count: number,
  fallback: [singular: string, plural: string],
  args: Array<string | number> = [],
): string {
  const label = id.includes(':')
    ? id
    : `${STUDIO_PACKAGE}:${STUDIO_SOURCE}:${id}`
  const forms = translationValue(label)
  const allArgs = [count, ...args]
  if (typeof forms === 'string') return interpolate(forms, allArgs)
  if (Array.isArray(forms)) {
    const form = forms[pluralFormIndex(count, forms.length)] ?? forms[0]
    if (form !== undefined) return interpolate(form, allArgs)
  }
  return interpolate(count === 1 ? fallback[0] : fallback[1], allArgs)
}

const CLDR_CATEGORY_ORDER: Intl.LDMLPluralRule[] = [
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
]

let pluralRules: Intl.PluralRules | null = null

/** Which of the locale's plural forms a count takes - Flow's PluralsReader. */
function pluralFormIndex(count: number, formCount: number): number {
  if (pluralRules === null) {
    try {
      pluralRules = new Intl.PluralRules(
        config.interfaceLanguage.replace(/_/g, '-'),
      )
    } catch {
      pluralRules = new Intl.PluralRules('en')
    }
  }
  const available = pluralRules.resolvedOptions().pluralCategories
  const categories = CLDR_CATEGORY_ORDER.filter((category) =>
    available.includes(category),
  )
  const index = categories.indexOf(pluralRules.select(count))
  // A catalogue with fewer forms than the locale has categories (an English
  // pair in a Polish file): singular for one, the last form otherwise.
  if (index < 0 || index >= formCount) return count === 1 ? 0 : formCount - 1
  return index
}
