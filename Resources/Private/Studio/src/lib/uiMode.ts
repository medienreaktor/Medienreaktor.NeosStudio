import { config } from '@/config'

/**
 * The Studio UI mode - a per-user preference stored in the Neos user's
 * preferences (`studio.uiMode`) and served both through /me/profile and the
 * shell's boot config. "dark" is the Studio default; "system" follows the OS
 * color scheme live. Applied by toggling the static `.dark` class on <html>
 * that styles.css pins its dark variant to.
 */
export type UiMode = 'light' | 'dark' | 'system'

export const UI_MODES: readonly UiMode[] = ['light', 'dark', 'system']

/**
 * The key Studio stores the mode under in the free-form /me/profile
 * preferences object. Namespaced: the server-side preference store is shared
 * with core keys and other clients.
 */
export const UI_MODE_PREFERENCE = 'studio.uiMode'

/** Coerce a raw preference value to a UiMode; dark is the Studio default. */
export function toUiMode(value: unknown): UiMode {
  return UI_MODES.includes(value as UiMode) ? (value as UiMode) : 'dark'
}

const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

let current: UiMode = 'dark'

function repaint() {
  const dark =
    current === 'dark' || (current === 'system' && systemDark.matches)
  document.documentElement.classList.toggle('dark', dark)
}

/** Switch the live theme, e.g. right after the preference was saved. */
export function applyUiMode(mode: UiMode) {
  current = mode
  repaint()
}

/**
 * Apply the boot-config mode before mount and follow OS scheme changes while
 * in "system" mode. index.html ships with `.dark` pre-set, so dark users (the
 * default) never see a theme change here.
 */
export function initUiMode() {
  systemDark.addEventListener('change', repaint)
  applyUiMode(config.uiMode)
}
