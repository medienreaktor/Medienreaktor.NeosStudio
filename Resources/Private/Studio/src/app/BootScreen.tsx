import { useState } from 'react'
import { cn } from '@/lib/utils'
import { translate as t } from '@/lib/i18n'

/**
 * The full-viewport boot screen: a large spinner centered on the shell's
 * background, shown from the first React render until the shell is booted
 * (see App.tsx). `done` fades it out; the caller unmounts it after the fade.
 *
 * Deliberately a CSS ring, not the FontAwesome spinner used elsewhere: the
 * static shell in index.html paints the very same ring (inline styles) before
 * the bundle runs, so the handover from static HTML to React is invisible -
 * the FontAwesome webfont is not guaranteed to be loaded that early. Keep the
 * two in sync (size 4rem, 4px ring, blue-500, 1s linear spin).
 *
 * The ring is mounted more than once while booting (the static one is
 * replaced by React, and this component moves from being the whole app to an
 * overlay inside the shell once authentication resolves) and a freshly
 * mounted element would restart its rotation at zero - a visible jump. So
 * every ring derives its rotation phase from the page's clock instead: a
 * negative animation-delay of "time since navigation, modulo one turn" makes
 * a new ring continue exactly where the previous one was.
 */
export function BootScreen({ done = false }: { done?: boolean }) {
  const [animationDelay] = useState(() => `-${performance.now() % 1000}ms`)
  return (
    <div
      role="status"
      aria-label={t('app.loadingStudio', 'Loading Neos Studio…')}
      aria-hidden={done}
      className={cn(
        'fixed inset-0 z-[900] grid place-items-center bg-white transition-opacity duration-300 dark:bg-neutral-950',
        done && 'pointer-events-none opacity-0',
      )}
    >
      <div
        className="size-16 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"
        style={{ animationDelay }}
      />
    </div>
  )
}
