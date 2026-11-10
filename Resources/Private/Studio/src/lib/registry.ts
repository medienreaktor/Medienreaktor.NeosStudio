import * as React from 'react'
import type { ObservableStore } from './observableRegistry'

// The registry base lives in a React-free module of its own, so the preview's
// guest bundle can build registries on it without pulling in React; the
// shell keeps importing everything from here.
export * from './observableRegistry'

/**
 * Subscribe a component to a registry's snapshot; re-renders whenever the
 * registry emits (register, unregister, or a subclass's re-emit).
 */
export function useRegistry<Def>(registry: ObservableStore<Def>): Def[] {
  return React.useSyncExternalStore(registry.subscribe, registry.getAll)
}

/**
 * Subscribe a component to a value derived from a registry - e.g. one entry
 * looked up by id - re-rendering when the registry emits and the derived
 * value changed. `select` must return a cached value (a stored definition,
 * a primitive), never a freshly built object or array: useSyncExternalStore
 * compares snapshots by identity and would loop otherwise.
 */
export function useRegistrySelector<Store extends ObservableStore<unknown>, T>(
  registry: Store,
  select: (registry: Store) => T,
): T {
  return React.useSyncExternalStore(registry.subscribe, () => select(registry))
}
