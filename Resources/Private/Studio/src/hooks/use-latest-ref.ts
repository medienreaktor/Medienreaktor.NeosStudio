import { type RefObject, useInsertionEffect, useRef } from 'react'

/**
 * A ref that always holds the value of the latest commit - the "latest ref"
 * pattern, for effects and event handlers that must call the current props
 * or callbacks without re-subscribing (and without listing them as effect
 * dependencies) whenever they change identity.
 *
 * The ref is written in an insertion effect rather than during render: render
 * must stay pure (React may render without committing, and the React
 * Compiler's react-hooks/refs rule rejects ref writes there). Insertion
 * effects run before every layout effect of the commit, so layout effects -
 * including children's, which run before the parent's - already see the new
 * value.
 *
 * Read `.current` only in effects, event handlers and other callbacks, never
 * during render. For a callback that does not need to be passed on, React 19's
 * useEffectEvent is the alternative.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value)
  useInsertionEffect(() => {
    ref.current = value
  })
  return ref
}
