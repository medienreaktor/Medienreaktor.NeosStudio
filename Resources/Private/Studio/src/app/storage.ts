/**
 * localStorage for the shell's remembered context (site, dimension, editing
 * workspace, selected document). Storage is unavailable in some privacy modes
 * and can throw on any access; remembering is a nicety, so every read degrades
 * to "nothing remembered" and every write to "not remembered" instead of
 * taking the shell down with an exception (same reasoning as deepLink.ts).
 */

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Remember the value - or forget it, for null. */
export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Not remembered - the next load falls back to the default.
  }
}
