/**
 * The boot handshake between the preview and the shell. The shell shows a
 * full-viewport boot screen over everything until the first preview page is
 * painted; the PreviewPane reports every painted page here and the shell
 * takes the first report as "booted". A plain module-level signal instead of
 * a StudioContext method: the boot screen is shell-internal, not plugin API.
 */
export type BootReport =
  /** The preview finished loading a page - booted once nothing is in flight. */
  | 'previewLoaded'
  /**
   * No page will ever reach the preview (no site to open, no document to
   * select) - booted right away, there is nothing to wait for.
   */
  | 'nothingToPreview'

const listeners = new Set<(report: BootReport) => void>()

/** The preview finished loading a page (its guest booted, or a guest-less page loaded). */
export function reportPreviewLoaded(): void {
  for (const listener of listeners) listener('previewLoaded')
}

/** Nothing will be previewed - the boot screen must not wait for a page. */
export function reportNothingToPreview(): void {
  for (const listener of listeners) listener('nothingToPreview')
}

export function subscribeBoot(
  listener: (report: BootReport) => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
