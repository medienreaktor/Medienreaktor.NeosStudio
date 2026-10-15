#!/usr/bin/env node
/**
 * Compare the translation ids the Studio uses with the XLIFF catalogues.
 *
 * Collects every bare id passed to translate()/t() and translatePlural()/tp()
 * in src/ (fully qualified "Package:Source:id" labels are someone else's
 * catalogue and skipped), then reads Resources/Private/Translations/<locale>/
 * Main.xlf and reports, per locale, the ids it is missing - and the ids no
 * call site uses any more.
 *
 * A template-literal id (t(`creation.mode.${mode}`, ...)) counts as using
 * every catalogue id that starts with its static prefix. Ids handed to a
 * translate call indirectly - a `labelKey: 'media.sortNewest'` table entry -
 * count as used too: properties named *Key are checked like call sites, and
 * any other string literal spelling a catalogue id exactly keeps it off the
 * unused list. Fully qualified "Medienreaktor.NeosStudio:Main:id" labels in
 * the package's PHP, YAML and Fusion count as used as well.
 *
 * Exit code 1 when the source catalogue (en) misses an id - that is a bug.
 * Gaps in the other locales are reported but only fail with --strict.
 *
 *   npm run i18n:check [-- --strict] [-- --verbose]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const studioRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = join(studioRoot, 'src')
const translationsRoot = join(studioRoot, '..', 'Translations')
const SOURCE_LOCALE = 'en'
const CATALOGUE = 'Main.xlf'

const strict = process.argv.includes('--strict')
const verbose = process.argv.includes('--verbose')

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return walk(path)
    return /\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts') ? [path] : []
  })
}

// --- Ids used in the source --------------------------------------------------

const CALL =
  /(?<![\w.$])(?:t|translate|tp|translatePlural)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g

const KEY_PROPERTY = /\b\w*[kK]ey:\s*(['"])([\w-]+(?:\.[\w-]+)+)\1/g
const LITERAL = /(['"])([\w-]+(?:\.[\w-]+)+)\1/g

/** id -> first file using it */
const used = new Map()
/** static prefixes of template-literal ids */
const prefixes = new Set()
/** every dotted string literal, for the unused check */
const literals = new Set()

for (const file of walk(sourceRoot)) {
  const code = readFileSync(file, 'utf8')
  for (const match of code.matchAll(CALL)) {
    const [, quote, id] = match
    if (id.includes(':')) continue
    if (quote === '`' && id.includes('${')) {
      prefixes.add(id.slice(0, id.indexOf('${')))
      continue
    }
    if (!used.has(id)) used.set(id, relative(studioRoot, file))
  }
  for (const match of code.matchAll(KEY_PROPERTY)) {
    if (!used.has(match[2])) used.set(match[2], relative(studioRoot, file))
  }
  for (const match of code.matchAll(LITERAL)) literals.add(match[2])
}

// The package's PHP, YAML and Fusion reach the catalogue by fully qualified
// label ("Medienreaktor.NeosStudio:Main:app.legacyUi") - those ids are used
// too.
const packageRoot = join(studioRoot, '..', '..', '..')
const QUALIFIED = /Medienreaktor\.NeosStudio:Main:([\w-]+(?:\.[\w-]+)*)/g

function walkPackage(directory) {
  return readdirSync(directory).flatMap((entry) => {
    if (entry === 'node_modules' || entry === 'Studio') return []
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return walkPackage(path)
    return /\.(php|ya?ml|fusion|html)$/.test(entry) ? [path] : []
  })
}

for (const directory of ['Classes', 'Configuration', 'Resources/Private']) {
  let files
  try {
    files = walkPackage(join(packageRoot, directory))
  } catch {
    continue
  }
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(QUALIFIED)) {
      if (!used.has(match[1])) used.set(match[1], relative(studioRoot, file))
    }
  }
}

// --- Ids in the catalogues ---------------------------------------------------

/** Plural forms are trans-units "id[0]", "id[1]" inside a group "id". */
function catalogueIds(path) {
  const xml = readFileSync(path, 'utf8')
  const ids = new Set()
  for (const match of xml.matchAll(/<trans-unit\s[^>]*\bid="([^"]+)"/g)) {
    ids.add(match[1].replace(/\[\d+\]$/, ''))
  }
  return ids
}

const locales = readdirSync(translationsRoot)
  .filter((locale) => {
    try {
      return statSync(join(translationsRoot, locale, CATALOGUE)).isFile()
    } catch {
      return false
    }
  })
  .sort((a, b) =>
    a === SOURCE_LOCALE ? -1 : b === SOURCE_LOCALE ? 1 : a.localeCompare(b),
  )

const catalogues = new Map(
  locales.map((locale) => [
    locale,
    catalogueIds(join(translationsRoot, locale, CATALOGUE)),
  ]),
)

// --- Report ------------------------------------------------------------------

const usedIds = [...used.keys()].sort()
let failed = false

console.log(
  `${usedIds.length} ids used in src/ and the package (+ ${prefixes.size} dynamic prefix(es)), ${locales.length} locales\n`,
)

for (const locale of locales) {
  const ids = catalogues.get(locale)
  const missing = usedIds.filter((id) => !ids.has(id))
  const isSource = locale === SOURCE_LOCALE
  if (missing.length > 0 && (isSource || strict)) failed = true
  console.log(
    `${locale.padEnd(6)} ${String(ids.size).padStart(5)} ids, ${missing.length} missing`,
  )
  if (missing.length > 0 && (isSource || verbose || missing.length <= 20)) {
    for (const id of missing) console.log(`         - ${id}  (${used.get(id)})`)
  }
}

const sourceIds = catalogues.get(SOURCE_LOCALE) ?? new Set()
const unused = [...sourceIds]
  .filter(
    (id) =>
      !used.has(id) &&
      !literals.has(id) &&
      ![...prefixes].some((prefix) => id.startsWith(prefix)),
  )
  .sort()
console.log(`\n${unused.length} unused id(s) in ${SOURCE_LOCALE}/${CATALOGUE}`)
for (const id of unused) console.log(`  - ${id}`)

process.exit(failed ? 1 : 0)
