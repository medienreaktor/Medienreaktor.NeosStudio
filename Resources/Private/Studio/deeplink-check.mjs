/**
 * Verifies src/app/deepLink.ts and src/app/flash.ts against the entry paths that matter: a fresh
 * link with and without a content node, the return from the OAuth redirect that strips the query
 * string, malformed input, and the buffering that lets a pulse be requested before the preview can
 * show it. Uses Node's native type stripping plus a resolve hook for the "@/" alias — the Studio
 * package carries no test framework and this must not add one. Removed again after the run.
 */
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve as resolvePath } from 'node:path'

const srcDir = resolvePath(import.meta.dirname, 'src')
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const target = resolvePath(srcDir, specifier.slice(2))
      return { url: `${pathToFileURL(target).href}.ts`, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

let failures = 0
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(52)}${ok ? '' : ` got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`,
  )
}

let evaluation = 0
async function loadWith({ url, stored, storedReveal }) {
  const store = new Map()
  if (stored !== undefined) store.set('neos-studio.deep_link', stored)
  if (storedReveal !== undefined) store.set('neos-studio.deep_link_reveal', storedReveal)
  let replaced = null
  globalThis.window = {
    location: { href: url },
    history: {
      replaceState: (_state, _title, next) => {
        replaced = next
      },
    },
  }
  globalThis.document = { title: 'Studio' }
  globalThis.sessionStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  }
  const module = await import(
    `${pathToFileURL(resolvePath(srcDir, 'app/deepLink.ts')).href}?v=${++evaluation}`
  )
  return { module, replaced, store }
}

const base64url = (value) => Buffer.from(value).toString('base64url')
const address = {
  contentRepositoryId: 'default',
  workspaceName: 'live',
  dimensionSpacePoint: { language: 'de', market: 'businesses' },
  aggregateId: 'aca08600-a470-4d8a-b85e-11bb15144a7a',
}
const encoded = base64url(JSON.stringify(address))
const contentId = '3e07e7a9-8894-4c53-b8fc-12c25f824306'

console.log('--- deep link with a content node ---')
{
  const { module, replaced, store } = await loadWith({
    url: `https://swk.test/neos/studio?node=${encoded}&reveal=${contentId}`,
  })
  check('document decoded', module.deepLinkTarget?.aggregateId, address.aggregateId)
  check('content node picked up', module.deepLinkReveal, contentId)
  check('both parameters stripped', replaced, 'https://swk.test/neos/studio')
  check('reveal lifted into storage', store.get('neos-studio.deep_link_reveal'), contentId)
  module.clearDeepLink()
  check('clearDeepLink clears both', store.size, 0)
}

console.log('\n--- page-only link (hit on a document property) ---')
{
  const { module } = await loadWith({ url: `https://swk.test/neos/studio?node=${encoded}` })
  check('document decoded', module.deepLinkTarget?.aggregateId, address.aggregateId)
  check('no content node', module.deepLinkReveal, null)
}

console.log('\n--- a page-only link clears a stale reveal ---')
{
  const { module } = await loadWith({
    url: `https://swk.test/neos/studio?node=${encoded}`,
    stored: encoded,
    storedReveal: contentId,
  })
  check('stale reveal dropped', module.deepLinkReveal, null)
}

console.log('\n--- return from OAuth (query string gone) ---')
{
  const { module, replaced } = await loadWith({
    url: 'https://swk.test/neos/studio',
    stored: encoded,
    storedReveal: contentId,
  })
  check('document survives', module.deepLinkTarget?.aggregateId, address.aggregateId)
  check('content node survives', module.deepLinkReveal, contentId)
  check('no pointless replaceState', replaced, null)
}

console.log('\n--- other query parameters are left alone ---')
{
  const { replaced } = await loadWith({
    url: `https://swk.test/neos/studio?code=abc&node=${encoded}&reveal=${contentId}&state=xyz`,
  })
  check('only ours removed', replaced, 'https://swk.test/neos/studio?code=abc&state=xyz')
}

console.log('\n--- reveal without a usable document is meaningless ---')
{
  const { module } = await loadWith({
    url: `https://swk.test/neos/studio?node=%%%broken%%%&reveal=${contentId}`,
  })
  check('document null', module.deepLinkTarget, null)
  check('reveal suppressed', module.deepLinkReveal, null)
}

console.log('\n--- malformed parameter must not break the shell ---')
for (const [label, value] of [
  ['not base64', '%%%not-base64%%%'],
  ['base64 but not json', base64url('nope')],
  ['json without aggregateId', base64url(JSON.stringify({ a: 1 }))],
  ['empty aggregateId', base64url(JSON.stringify({ ...address, aggregateId: '' }))],
  ['no dimensionSpacePoint', base64url(JSON.stringify({ ...address, dimensionSpacePoint: null }))],
]) {
  const { module } = await loadWith({
    url: `https://swk.test/neos/studio?node=${encodeURIComponent(value)}`,
  })
  check(label, module.deepLinkTarget, null)
}

console.log('\n--- flash buffering (request may precede a ready guest) ---')
{
  const flash = await import(`${pathToFileURL(resolvePath(srcDir, 'app/flash.ts')).href}`)
  check('nothing pending initially', flash.takePendingFlash(), null)

  flash.flashNode(contentId)
  check('request survives until drained', flash.takePendingFlash(), contentId)
  check('draining consumes it', flash.takePendingFlash(), null)

  let notified = 0
  const unsubscribe = flash.subscribeFlashRequest(() => notified++)
  flash.flashNode(contentId)
  check('subscriber notified', notified, 1)
  check('subscriber can drain', flash.takePendingFlash(), contentId)
  unsubscribe()
  flash.flashNode(contentId)
  check('no notification after unsubscribe', notified, 1)
  check('but request still buffered', flash.takePendingFlash(), contentId)
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
