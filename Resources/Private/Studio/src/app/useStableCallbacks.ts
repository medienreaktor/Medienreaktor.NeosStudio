import { useState } from 'react'
import { useLatestRef } from '@/hooks/use-latest-ref'

type Callback = (...args: never[]) => unknown
type Callbacks = Record<string, Callback>

/**
 * Stable wrappers around callbacks that close over the latest render's state:
 * the returned object and its functions keep their identity for the
 * component's lifetime, while every call runs the implementation of the most
 * recent commit (the "latest ref" pattern).
 *
 * For handing actions to many consumers through context - a context value
 * that changes on every render re-renders all of them. Only for callbacks
 * called from event handlers and effects, never during render: an
 * implementation becomes current with the commit, not with the render.
 */
export function useStableCallbacks<T extends Callbacks>(implementations: T): T {
  const latest = useLatestRef(implementations)
  // The key set is fixed by the call site, so the first render's keys are
  // all there ever are. The wrappers only read the ref when called.
  const [stable] = useState(() => {
    const wrappers: Record<string, (...args: unknown[]) => unknown> = {}
    for (const key of Object.keys(implementations)) {
      wrappers[key] = (...args) =>
        (latest.current[key] as (...args: unknown[]) => unknown)(...args)
    }
    return wrappers as unknown as T
  })
  return stable
}
