import * as React from 'react'

/**
 * "Open the review on this workspace" requests from outside the review - a
 * clicked comment notification. Held in a tiny observable store (not context)
 * because the requester (the notification bell) and the review button live in
 * unrelated trees.
 *
 * Mirrors the task board's focus store, but leads somewhere else on purpose: a
 * comment on a change is about the change, so it opens the review on that
 * workspace (and the compare view on that page), not a task card.
 */

export interface ReviewFocusRequest {
  workspaceName: string
  /** Open the side-by-side comparison on this page right away. */
  documentAggregateId?: string
}

let pending: ReviewFocusRequest | null = null
const listeners = new Set<() => void>()

export function requestReviewFocus(request: ReviewFocusRequest): void {
  pending = request
  listeners.forEach((listener) => listener())
}

export function consumeReviewFocus(): void {
  pending = null
  listeners.forEach((listener) => listener())
}

export function usePendingReviewFocus(): ReviewFocusRequest | null {
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
