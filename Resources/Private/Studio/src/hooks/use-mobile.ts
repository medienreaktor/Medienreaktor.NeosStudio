import * as React from 'react'

/**
 * Tailwind's md breakpoint, in rem like Tailwind's own: a media query's rem is
 * the browser's default font size, so the breakpoint moves with it.
 */
const MOBILE_QUERY = '(width < 48rem)'

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = () => {
      setIsMobile(mql.matches)
    }
    mql.addEventListener('change', onChange)
    setIsMobile(mql.matches)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return !!isMobile
}
