#!/usr/bin/env node
/**
 * Build the plugin API's type declarations as one self-contained file:
 * Resources/Public/Studio/types/index.d.ts.
 *
 * 1. `tsc -p tsconfig.plugin-api.json --noCheck` emits the .d.ts closure of
 *    src/plugin-api/index.ts (~120 files, incl. the ~400 kB OpenAPI schema)
 *    into node_modules/.cache/plugin-api-dts. `--noCheck` skips type checking
 *    (`npm run build` already ran the full `tsc`), so an unrelated error
 *    elsewhere in src/ cannot block it. tsc leaves the `@/` path aliases in
 *    the emitted files as they are.
 * 2. rolldown + rolldown-plugin-dts bundle that closure from the entry
 *    plugin-api/index.d.ts, resolving `@/x` to the emitted files. Only React
 *    stays external (a plugin has @types/react anyway); every other npm
 *    package the surface reaches - Base UI behind the UI primitives' props,
 *    class-variance-authority, clsx, ... - is inlined from its own .d.ts, so
 *    a plugin needs none of them installed and always sees the versions the
 *    shell runs. Tree-shaking leaves only what the public surface reaches
 *    (~390 kB, most of it Base UI's prop types).
 *
 * Runs at the end of `npm run build`: the SPA build empties
 * Resources/Public/Studio first, so the types must be written after it.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'rolldown'
import { dts } from 'rolldown-plugin-dts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const emitted = path.join(root, 'node_modules/.cache/plugin-api-dts')
const outDir = path.resolve(root, '../../Public/Studio/types')

fs.rmSync(emitted, { recursive: true, force: true })
execFileSync(
  path.join(root, 'node_modules/.bin/tsc'),
  ['-p', 'tsconfig.plugin-api.json', '--noCheck'],
  { cwd: root, stdio: 'inherit' },
)

/** Resolve the shell's `@/x` alias against the emitted declarations. */
const atAlias = {
  name: 'resolve-at-alias',
  resolveId(id) {
    if (!id.startsWith('@/')) return null
    const base = path.join(emitted, id.slice(2))
    for (const candidate of [`${base}.d.ts`, path.join(base, 'index.d.ts')]) {
      if (fs.existsSync(candidate)) return candidate
    }
    throw new Error(`build-plugin-types: cannot resolve ${id}`)
  },
}

/** Packages a plugin resolves itself: React and its subpaths. */
const isReact = (id) => /^react(-dom)?(\/|$)/.test(id)
const packageName = (id) =>
  id
    .split('/')
    .slice(0, id.startsWith('@') ? 2 : 1)
    .join('/')

/** The first `types` entry in a package.json `exports` condition tree. */
function typesOf(entry) {
  if (typeof entry === 'string') return entry.endsWith('.ts') ? entry : null
  if (!entry || typeof entry !== 'object') return null
  if (typeof entry.types === 'string') return entry.types
  for (const key of ['import', 'default', 'require']) {
    const found = typesOf(entry[key])
    if (found) return found
  }
  return null
}

/** The ES module (else any) JavaScript target of an `exports` entry. */
function jsOf(entry) {
  if (typeof entry === 'string') return /\.(m|c)?js$/.test(entry) ? entry : null
  if (!entry || typeof entry !== 'object') return null
  for (const key of ['import', 'default', 'require']) {
    const found = jsOf(entry[key])
    if (found) return found
  }
  return null
}

/**
 * Resolve a bare import inside the declarations (`@base-ui/react/select`,
 * `clsx`, ...) to the package's own .d.ts - looked up from the importing file
 * upwards, so nested node_modules win as they do for Node - and so inline it.
 */
const inlinePackageTypes = {
  name: 'inline-package-types',
  resolveId(id, importer) {
    if (id.startsWith('.') || id.startsWith('@/') || path.isAbsolute(id))
      return null
    if (isReact(id)) return null
    const name = packageName(id)
    const subpath = '.' + id.slice(name.length)
    let dir = importer ? path.dirname(importer) : root
    let packageDir = null
    for (;;) {
      const candidate = path.join(dir, 'node_modules', name)
      if (fs.existsSync(path.join(candidate, 'package.json'))) {
        packageDir = candidate
        break
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    packageDir ??= path.join(root, 'node_modules', name)
    const manifest = JSON.parse(
      fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
    )
    const entry = manifest.exports?.[subpath]
    let types = typesOf(entry)
    if (!types && subpath === '.') types = manifest.types ?? manifest.typings
    if (types) return path.join(packageDir, types)
    // No `types` condition (openapi-fetch, ...): like TypeScript, look for
    // the declaration file next to the JavaScript entry point.
    const script =
      jsOf(entry) ??
      (subpath === '.' ? (manifest.module ?? manifest.main) : null)
    if (script) {
      const sibling = path.join(
        packageDir,
        script.replace(/\.(m|c)?js$/, (_, kind) => `.d.${kind ?? ''}ts`),
      )
      if (fs.existsSync(sibling)) return sibling
    }
    throw new Error(`build-plugin-types: no type declarations for ${id}`)
  },
}

fs.rmSync(outDir, { recursive: true, force: true })
await build({
  cwd: emitted,
  input: { index: path.join(emitted, 'plugin-api/index.d.ts') },
  // React is the only package the plugin resolves itself; the others are
  // inlined by inlinePackageTypes.
  external: (id) => isReact(id),
  // dtsInput: bundle already-emitted .d.ts; oxc/tsconfig:false keep the
  // plugin from loading the TypeScript JS API, which TS 7 no longer ships.
  plugins: [
    atAlias,
    inlinePackageTypes,
    dts({ dtsInput: true, emitDtsOnly: true, oxc: true, tsconfig: false }),
  ],
  output: {
    dir: outDir,
    format: 'es',
    banner:
      '// Generated by `npm run build:plugin-types` from src/plugin-api/index.ts - do not edit.',
  },
  logLevel: 'warn',
})
fs.rmSync(emitted, { recursive: true, force: true })

// rolldown labels each inlined module with its path relative to the build's
// cwd (the cache dir inside node_modules), so packages read
// `../../@base-ui/react/...`. Label them by package path alone - also for a
// nested node_modules, whose climb could otherwise run through this
// machine's directories.
const file = path.join(outDir, 'index.d.ts')
fs.writeFileSync(
  file,
  fs
    .readFileSync(file, 'utf8')
    .replace(/^(\/\/#region )(?:\S*\/node_modules\/|(?:\.\.\/)+)/gm, '$1'),
)
const kb = (fs.statSync(file).size / 1024).toFixed(0)
console.log(`plugin API types: ${path.relative(root, file)} (${kb} kB)`)
