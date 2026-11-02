import * as React from 'react'

/**
 * Tailwind's md breakpoint, in rem like Tailwind's own: a media query's rem is
 * the browser's default font size, so the breakpoint moves with it.
 */
const MOBILE_QUERY = '(width < 48rem)'

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function isMobileNow(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches
}

/** Whether the viewport is below the mobile breakpoint - live. */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, isMobileNow)
}
