import * as React from 'react'

/**
 * "Open this task on the board" requests from outside the tasks feature -
 * e.g. a clicked notification. The board consumes the pending request once
 * its data contains the workspace: it opens the task's detail dialog and
 * clears the request. Held in a tiny observable store (not context) because
 * the requester (the notification bell) and the board live in unrelated
 * trees, and the board may not even be mounted yet when the request fires.
 */

let pending: string | null = null
const listeners = new Set<() => void>()

export function requestTaskFocus(workspaceName: string): void {
  pending = workspaceName
  listeners.forEach((listener) => listener())
}

export function consumeTaskFocus(): void {
  pending = null
  listeners.forEach((listener) => listener())
}

export function usePendingTaskFocus(): string | null {
  return React.useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
      }
    },
    () => pending,
  )
}
