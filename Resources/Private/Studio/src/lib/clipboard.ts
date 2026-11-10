/**
 * Copy text to the system clipboard from a click handler. Call it
 * synchronously in the handler, before any await: browsers only allow the
 * write while the click's user activation is still current.
 *
 * Chrome also refuses while the Studio's document doesn't hold focus, and
 * Safari doesn't move focus to a button on click - pass the clicked element
 * as `trigger` and it is focused first. Safari only checks the window's
 * transient activation, and sometimes doesn't grant it for a click at all;
 * nothing here can restore it, so callers must offer a manual way to copy
 * when this rejects. A refused write falls back to the legacy copy command
 * (it fires a copy event whose data we set ourselves, so no temporary
 * textarea has to steal focus from a dialog's focus trap). Rejects only
 * when both ways fail.
 */
export async function copyText(
  text: string,
  trigger?: HTMLElement | null,
): Promise<void> {
  trigger?.focus({ preventScroll: true })
  // Taken before the write: by the time it is refused, activation may have
  // lapsed for unrelated reasons.
  const context = clipboardContext()
  try {
    await navigator.clipboard.writeText(text)
  } catch (error) {
    console.warn(
      'Clipboard API refused to write, using the copy command',
      error,
      context,
    )
    if (!copyWithCommand(text)) {
      console.warn('The copy command failed too', context)
      throw error
    }
  }
}

function copyWithCommand(text: string): boolean {
  const onCopy = (event: ClipboardEvent) => {
    event.clipboardData?.setData('text/plain', text)
    event.preventDefault()
  }
  document.addEventListener('copy', onCopy)
  try {
    // Deprecated, but the one way to copy without the async API.
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.removeEventListener('copy', onCopy)
  }
}

/** What browsers base the clipboard decision on, for the console. */
function clipboardContext() {
  const activation = (
    navigator as Navigator & {
      userActivation?: { isActive: boolean; hasBeenActive: boolean }
    }
  ).userActivation
  const active = document.activeElement
  return {
    documentHasFocus: document.hasFocus(),
    activeElement: active
      ? `${active.tagName.toLowerCase()}${active.getAttribute('aria-label') ? `[${active.getAttribute('aria-label')}]` : ''}`
      : null,
    userActivationIsActive: activation?.isActive,
    userActivationHasBeenActive: activation?.hasBeenActive,
  }
}
