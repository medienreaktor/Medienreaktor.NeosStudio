// Fails the build when a CSS variable plugins may rely on (src/plugin-api/css-variables.json)
// is not declared in the built stylesheet. The names come from Figma through figma-tools, so a
// renamed variable or text style would otherwise only surface as a plugin silently losing its
// colour or size.
import { readFileSync, readdirSync } from 'node:fs'

const contract = JSON.parse(
  readFileSync(
    new URL('../src/plugin-api/css-variables.json', import.meta.url),
    'utf8',
  ),
)
const assets = new URL('../../../Public/Studio/assets/', import.meta.url)
const css = readdirSync(assets)
  .filter((file) => /^index-.*\.css$/.test(file))
  .map((file) => readFileSync(new URL(file, assets), 'utf8'))
  .join('\n')

if (css === '') {
  console.error(
    'check-css-variables: no built stylesheet found in',
    assets.pathname,
  )
  process.exit(1)
}

const declared = new Set(css.match(/--[\w-]+(?=\s*:)/g))
const expected = Object.entries(contract)
  .filter(([group]) => !group.startsWith('$'))
  .flatMap(([group, names]) =>
    group === 'text'
      ? names.flatMap((name) => [name, `${name}--line-height`])
      : names,
  )
const missing = expected.filter((name) => !declared.has(name))

if (missing.length > 0) {
  console.error(
    `check-css-variables: ${missing.length} public CSS variable(s) missing from the build:\n  ` +
      missing.join('\n  ') +
      '\nRestore them in Figma, keep the old name through extraNames in figma-tools.json, or remove' +
      ' them from src/plugin-api/css-variables.json once no plugin uses them.',
  )
  process.exit(1)
}

console.log(
  `check-css-variables: all ${expected.length} public CSS variables are declared.`,
)
