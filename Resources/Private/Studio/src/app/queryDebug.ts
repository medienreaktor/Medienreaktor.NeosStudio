import type { QueryClient } from '@tanstack/react-query'
import { readStored } from './storage'

/**
 * Opt-in fetch statistics, to see what an edit makes the shell re-read.
 * Turned on per browser, in any environment (performance problems show in
 * large production projects, not in the dev site):
 *
 *   localStorage.setItem('studio.debugQueries', '1')  // then reload
 *
 * Every fetch the query cache starts - observed queries and the trees'
 * fetchQuery reads alike - is counted by its key's first segments
 * (e.g. "workspaces/<cr>/workspace" or "nodes/<cr>/<ws>"). After a burst of
 * fetches settles, one collapsed console group lists the burst's counts, so
 * a save, a page creation or a publish each shows up as its own group.
 * `window.studioQueryStats()` returns the totals since the page loaded and
 * `window.studioQueryStats(true)` resets them.
 */

const STORAGE_KEY = 'studio.debugQueries'
/** Key segments a fetch is grouped by - enough to tell the reads apart. */
const KEY_DEPTH = 3
/** Quiet time after which a burst of fetches counts as settled. */
const BURST_SETTLE_MS = 1_000

export function installQueryDebug(queryClient: QueryClient): void {
  if (readStored(STORAGE_KEY) !== '1') return

  const totals = new Map<string, number>()
  let burst = new Map<string, number>()
  let burstStart = 0
  let settleTimer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    const entries = [...burst.entries()].sort((a, b) => b[1] - a[1])
    const count = entries.reduce((sum, [, n]) => sum + n, 0)
    const duration = Math.round(performance.now() - burstStart)
    console.groupCollapsed(
      `[studio] ${count} fetch${count === 1 ? '' : 'es'} in ${duration} ms`,
    )
    console.table(Object.fromEntries(entries))
    console.groupEnd()
    burst = new Map()
  }

  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'fetch') return
    const group = event.query.queryKey
      .slice(0, KEY_DEPTH)
      .map((part: unknown) =>
        typeof part === 'string' ? part : JSON.stringify(part),
      )
      .join('/')
    if (burst.size === 0) burstStart = performance.now()
    burst.set(group, (burst.get(group) ?? 0) + 1)
    totals.set(group, (totals.get(group) ?? 0) + 1)
    clearTimeout(settleTimer)
    settleTimer = setTimeout(flush, BURST_SETTLE_MS)
  })

  ;(
    window as unknown as {
      studioQueryStats: (reset?: boolean) => Record<string, number>
    }
  ).studioQueryStats = (reset = false) => {
    const result = Object.fromEntries(totals)
    if (reset) totals.clear()
    return result
  }
  console.info(
    `[studio] query fetch statistics on (localStorage ${STORAGE_KEY})`,
  )
}
