export interface BatchLoaderOptions<T> {
  /**
   * Load the items with these ids from one group (one subgraph, say). Items
   * left out of the result resolve to null.
   */
  load: (group: string, ids: string[]) => Promise<T[]>
  idOf: (item: T) => string
  /** Ids per load call at most; more are split into several calls. */
  maxPerRequest: number
}

interface Pending<T> {
  resolve: (item: T | null) => void
  reject: (error: unknown) => void
}

/**
 * Merges the loads requested within one tick into one load call per group
 * (split at maxPerRequest ids). The same id asked for twice is loaded once.
 */
export function createBatchLoader<T>({
  load,
  idOf,
  maxPerRequest,
}: BatchLoaderOptions<T>): (group: string, id: string) => Promise<T | null> {
  let queued = new Map<string, Map<string, Pending<T>[]>>()

  const flush = () => {
    const groups = queued
    queued = new Map()
    for (const [group, waiting] of groups) {
      const ids = [...waiting.keys()]
      for (let i = 0; i < ids.length; i += maxPerRequest) {
        const chunk = ids.slice(i, i + maxPerRequest)
        const settle = (each: (pending: Pending<T>, id: string) => void) => {
          for (const id of chunk) {
            for (const pending of waiting.get(id)!) each(pending, id)
          }
        }
        Promise.resolve()
          .then(() => load(group, chunk))
          .then(
            (items) => {
              const byId = new Map(items.map((item) => [idOf(item), item]))
              settle((pending, id) => pending.resolve(byId.get(id) ?? null))
            },
            (error: unknown) => settle((pending) => pending.reject(error)),
          )
      }
    }
  }

  return (group, id) =>
    new Promise<T | null>((resolve, reject) => {
      if (queued.size === 0) setTimeout(flush, 0)
      let waiting = queued.get(group)
      if (!waiting) {
        waiting = new Map()
        queued.set(group, waiting)
      }
      let pending = waiting.get(id)
      if (!pending) {
        pending = []
        waiting.set(id, pending)
      }
      pending.push({ resolve, reject })
    })
}
