import * as React from 'react'

const MOBILE_BREAKPOINT = 768

const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(query)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function isMobileNow(): boolean {
  return window.matchMedia(query).matches
}

/** Whether the viewport is below the mobile breakpoint - live. */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, isMobileNow)
}
