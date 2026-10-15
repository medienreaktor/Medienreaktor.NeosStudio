import * as React from 'react'

/**
 * The shared base of Studio's extension registries (panels, settings
 * sections, shortcuts, property editors, inspector views, validators, link
 * types, node and workspace decorators): a small observable, id-keyed store.
 *
 * - Registering an already-known id replaces it, so HMR and plugin reloads
 *   stay idempotent (the entry keeps its original registration position, as
 *   Map.set does). Unregistering an unknown id is a no-op.
 * - The snapshot returned by {@link ObservableRegistry.getAll} is cached: its
 *   identity changes only on a mutation (or an explicit re-emit by a
 *   subclass), which is exactly the contract React's useSyncExternalStore
 *   needs to stay quiet between changes.
 * - `subscribe` and `getAll` are bound to the instance, so they can be handed
 *   to useSyncExternalStore as-is without a wrapper closure (a fresh closure
 *   per render would make React resubscribe every render).
 *
 * Feature registries subclass it (adding lookups, dispatch, or a public
 * `refresh()` on top of {@link ObservableRegistry.emit}) or compose it when
 * their public signatures diverge from the base.
 */

/** The minimum every registered definition provides. */
export interface RegistryEntry {
  /** Unique id. Third-party entries should namespace ('vendor.package:thing'). */
  id: string
  /**
   * Sort weight, consulted only by registries created with
   * `{ sort: 'order' }`. Lower comes first; equal weights keep registration
   * order. Defaults to {@link DEFAULT_ORDER}.
   */
  order?: number
}

/** The sort weight of an entry without an explicit `order`. */
export const DEFAULT_ORDER = 100

export interface ObservableRegistryOptions {
  /**
   * Snapshot ordering: 'registration' (default) lists entries in registration
   * order; 'order' sorts by `order` (lower first, default
   * {@link DEFAULT_ORDER}), keeping registration order among equals - the
   * sort is stable.
   */
  sort?: 'registration' | 'order'
}

/**
 * The read side of a registry as React consumes it - what the hook helpers
 * below accept, so composed registries (which forward rather than extend)
 * work with them too.
 */
export interface ObservableStore<Def> {
  /** Bound; returns the unsubscriber. */
  readonly subscribe: (listener: () => void) => () => void
  /** Bound; returns the cached snapshot. */
  readonly getAll: () => Def[]
}

export class ObservableRegistry<
  Def extends RegistryEntry,
> implements ObservableStore<Def> {
  /** id → definition, in registration order. */
  protected readonly definitions = new Map<string, Def>()
  private readonly listeners = new Set<() => void>()
  private snapshot: Def[] = []
  private readonly sort: 'registration' | 'order'

  constructor(options: ObservableRegistryOptions = {}) {
    this.sort = options.sort ?? 'registration'
  }

  /** Registering an already-known id replaces it, so HMR and plugin reloads stay idempotent. */
  register(definition: Def): void {
    this.definitions.set(definition.id, definition)
    this.emit()
  }

  /** Remove an entry; unknown ids are ignored (and notify nobody). */
  unregister(id: string): void {
    if (this.definitions.delete(id)) this.emit()
  }

  /** The definition registered under an id, or undefined (also for a nullish id). */
  get(id: string | null | undefined): Def | undefined {
    if (!id) return undefined
    return this.definitions.get(id)
  }

  /** Alias of {@link get}, for registries whose `get` historically returned something else. */
  getDefinition(id: string | null | undefined): Def | undefined {
    return this.get(id)
  }

  /**
   * Stable snapshot (registration or `order` order, see the constructor
   * options) - changes identity only when the registry emits, so
   * useSyncExternalStore stays quiet otherwise. Bound to the instance.
   */
  readonly getAll = (): Def[] => this.snapshot

  /** Listen for changes; returns the unsubscriber. Bound to the instance. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Rebuild the snapshot (a new array identity) and notify subscribers.
   * Called on every mutation; subclasses call it to re-emit without one
   * (e.g. a decorator's own data changed, so its output did).
   */
  protected emit(): void {
    const all = [...this.definitions.values()]
    this.snapshot =
      this.sort === 'order'
        ? all.sort(
            (a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER),
          )
        : all
    this.onSnapshot(this.snapshot)
    this.listeners.forEach((listener) => listener())
  }

  /**
   * Hook for subclasses maintaining derived indexes: runs after the snapshot
   * is rebuilt and before subscribers are notified, so they never observe a
   * stale index.
   */
  protected onSnapshot(_snapshot: readonly Def[]): void {}
}

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
