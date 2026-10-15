import { useSyncExternalStore } from 'react'

/**
 * The content repository the shell works in: the one of the selected site.
 * The App sets it whenever the site changes; the reads that belong to a
 * content repository (workspaces, node types, its dimensions, the Studio's
 * tasks and workspace read models) take it from here and carry it in their
 * query keys, so sites in different content repositories never share a
 * cache entry. Reads of a node take it from the node's address instead.
 */

let active: string | null = null
const listeners = new Set<() => void>()

export function setActiveContentRepositoryId(id: string | null): void {
  if (id === active) return
  active = id
  listeners.forEach((listener) => listener())
}

/**
 * The active content repository, for imperative calls (mutations, fetches).
 * Throws while no site is selected - nothing that needs one runs before.
 */
export function activeContentRepositoryId(): string {
  if (active === null) {
    throw new Error('No content repository yet: no site is selected')
  }
  return active
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The active content repository, null until a site is selected. */
export function useActiveContentRepositoryId(): string | null {
  return useSyncExternalStore(subscribe, () => active)
}
