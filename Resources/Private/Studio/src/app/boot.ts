/**
 * The boot handshake between the preview and the shell. The shell shows a
 * full-viewport boot screen over everything until the first preview page is
 * painted; the PreviewPane reports every painted page here and the shell
 * takes the first report as "booted". A plain module-level signal instead of
 * a StudioContext method: the boot screen is shell-internal, not plugin API.
 */
const listeners = new Set<() => void>()

/** The preview finished loading a page (its guest booted, or a guest-less page loaded). */
export function reportPreviewLoaded(): void {
  for (const listener of listeners) listener()
}

export function subscribePreviewLoaded(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
