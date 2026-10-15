import { useEffect, useState } from 'react'
import { useIsFetching } from '@tanstack/react-query'
import { BootScreen } from '@/app/BootScreen'
import { subscribeBoot } from '@/app/boot'

// The boot screen never outstays its welcome: whatever fails to report (a
// preview that never paints, a request that hangs) the shell is uncovered
// after this long and the panels show their own error/loading states.
const BOOT_TIMEOUT_MS = 15_000
// Matches BootScreen's fade-out; the overlay unmounts after it.
const BOOT_FADE_MS = 300

/**
 * The boot screen over the authenticated shell: it covers the shell from the
 * first render until the first preview page has painted and no request is in
 * flight anymore (the trees and the inspector have their data by then) - so
 * the user sees one spinner instead of a shell assembling itself panel by
 * panel. `booted` latches: later site/dimension/workspace switches reload the
 * preview uncovered.
 *
 * Its own component because useIsFetching() re-renders on every request the
 * shell makes - here that is this overlay alone, and once booted it unmounts
 * and stops listening altogether.
 */
export function BootOverlay() {
  const [booted, setBooted] = useState(false)
  const [mounted, setMounted] = useState(true)
  useEffect(() => {
    if (booted) return
    const timer = setTimeout(() => setBooted(true), BOOT_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [booted])
  useEffect(() => {
    if (!booted) return
    const timer = setTimeout(() => setMounted(false), BOOT_FADE_MS)
    return () => clearTimeout(timer)
  }, [booted])
  if (!mounted) return null
  return (
    <>
      <BootScreen done={booted} />
      {!booted && <BootWatcher onBooted={setBooted} />}
    </>
  )
}

/**
 * Watches for the moment booting is done. Split off so the request counter
 * is only observed until then - the fading screen no longer needs it.
 */
function BootWatcher({ onBooted }: { onBooted: (booted: true) => void }) {
  const [previewLoaded, setPreviewLoaded] = useState(false)
  const inFlightQueries = useIsFetching()
  useEffect(
    () =>
      subscribeBoot((report) => {
        if (report === 'previewLoaded') setPreviewLoaded(true)
        // Nothing will reach the preview - nothing to wait for either.
        else onBooted(true)
      }),
    [onBooted],
  )
  useEffect(() => {
    if (previewLoaded && inFlightQueries === 0) onBooted(true)
  }, [previewLoaded, inFlightQueries, onBooted])
  return null
}
