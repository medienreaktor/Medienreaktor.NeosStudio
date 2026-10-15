import { useState } from 'react'

/**
 * Calls `onChange` while rendering whenever `value` differs (Object.is) from
 * the previous render's - React's "adjust state when a prop changes" pattern,
 * e.g. resetting a dialog's form state each time it opens.
 *
 * Unlike an effect, which commits and paints one frame with the stale state
 * and then renders again, a state update made here makes React re-render the
 * component right away, before its children and before anything is painted.
 *
 * `onChange` runs during render: it may only set this component's state - no
 * other side effects (no requests, no external stores, no ref writes), as a
 * render may be repeated or discarded.
 */
export function useValueChange<T>(
  value: T,
  onChange: (value: T, previous: T) => void,
): void {
  const [previous, setPrevious] = useState(value)
  if (!Object.is(previous, value)) {
    setPrevious(value)
    onChange(value, previous)
  }
}
