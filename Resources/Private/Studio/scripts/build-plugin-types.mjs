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
      // The real path: relative imports between the emitted files resolve to
      // it, and a module reached under two paths (node_modules symlinked into
      // a worktree) would be inlined twice.
      if (fs.existsSync(candidate)) return fs.realpathSync(candidate)
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
  unwrapInlinedAugmentations(
    fs
      .readFileSync(file, 'utf8')
      .replace(/^(\/\/#region )(?:\S*\/node_modules\/|(?:\.\.\/)+)/gm, '$1'),
  ),
)

/**
 * TipTap's extensions add their commands to `Commands` by augmenting the
 * module: `declare module '@tiptap/core' { interface Commands<ReturnType> {
 * ... } }`. Inlining turns @tiptap/core's own `interface Commands` into a
 * declaration of this file, but leaves the augmentations pointing at a module
 * a plugin doesn't have - they merge into nothing, and `editor.chain()`
 * offers no commands at all. Unwrapping them into top-level declarations of
 * this file makes them merge with the inlined interface, as they did with the
 * package. The type parameter must read exactly as the inlined declaration's
 * for the declarations to merge.
 */
function unwrapInlinedAugmentations(source) {
  const inlined = ['@tiptap/core']
  let unwrapped = 0
  const result = source.replace(
    /^declare module '([^']+)' \{\n([\s\S]*?)^\}\n/gm,
    (block, moduleName, body) => {
      if (!inlined.includes(moduleName)) return block
      unwrapped++
      return body
        .replace(/^ {2}/gm, '')
        .replace(
          /^interface Commands<ReturnType> \{/gm,
          'interface Commands<ReturnType = any> {',
        )
    },
  )
  if (unwrapped === 0)
    throw new Error(
      'build-plugin-types: found no TipTap command augmentations to unwrap - check the TipTap types',
    )
  return result
}
const kb = (fs.statSync(file).size / 1024).toFixed(0)
console.log(`plugin API types: ${path.relative(root, file)} (${kb} kB)`)

// The types directory doubles as a types-only npm package named like the
// import plugins write, so a plugin can `npm install -D
// @medienreaktor/neos-studio@<Studio version>` instead of mapping a path into
// this package. It ships no JavaScript on purpose: at runtime the import
// resolves to window.NeosStudio through the plugin bundler's externals, and a
// plugin that forgets those fails at build time rather than bundling a stub.
// Published by `npm run publish:plugin-types`, versioned with Studio.
const studio = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
)
const manifest = {
  name: '@medienreaktor/neos-studio',
  version: studio.version,
  description:
    'TypeScript declarations of the Neos Studio plugin API (window.NeosStudio). Types only - mark the import external in your plugin bundle.',
  license: 'GPL-3.0-or-later',
  homepage:
    'https://github.com/medienreaktor/Medienreaktor.NeosStudio#extending-studio',
  repository: {
    type: 'git',
    url: 'git+https://github.com/medienreaktor/Medienreaktor.NeosStudio.git',
    directory: 'Resources/Public/Studio/types',
  },
  keywords: ['neos', 'neos-studio', 'plugin', 'types'],
  types: './index.d.ts',
  exports: { '.': { types: './index.d.ts' } },
  files: ['index.d.ts', 'README.md'],
  sideEffects: false,
  // The declarations import React's and ReactDOM's types (for the window
  // globals); the plugin brings them, in the React major the shell runs.
  peerDependencies: {
    '@types/react': studio.devDependencies?.['@types/react'] ?? '^19',
    '@types/react-dom': studio.devDependencies?.['@types/react-dom'] ?? '^19',
  },
}
fs.writeFileSync(
  path.join(outDir, 'package.json'),
  JSON.stringify(manifest, null, 2) + '\n',
)
fs.writeFileSync(
  path.join(outDir, 'README.md'),
  `# @medienreaktor/neos-studio

TypeScript declarations of the [Neos Studio](https://github.com/medienreaktor/Medienreaktor.NeosStudio)
plugin API, version ${studio.version} of Studio. Types only: a plugin imports from
\`@medienreaktor/neos-studio\` and marks that import (and \`react\`, \`react-dom\`,
\`react/jsx-runtime\`) external in its bundler, mapped to the globals the shell
publishes (\`window.NeosStudio\`, \`window.React\`, ...). Install the version
matching the Studio you build against:

\`\`\`bash
npm install -D @medienreaktor/neos-studio@${studio.version} @types/react
\`\`\`

See "Extending Studio" in Studio's README for the full setup.
`,
)
