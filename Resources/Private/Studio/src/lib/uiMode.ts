import { config } from '@/config'

/**
 * The Studio UI mode - a per-user preference stored in the Neos user's
 * preferences (`studio.uiMode`) and served both through /me/profile and the
 * shell's boot config. "dark" is the Studio default; "system" follows the OS
 * color scheme live. Applied as data-theme="light" | "dark" on <html>, which
 * the semantic tokens in styles/semantics.css switch on.
 *
 * The `.dark` class is set alongside, as a deprecated hook for Studio plugins
 * that still style their own dark mode with `html.dark` (AIToolkit, the icon
 * select and focal point editors). Studio itself does not read it; drop it
 * once those plugins use the semantic tokens.
 */
export type UiMode = 'light' | 'dark' | 'system'

const UI_MODES: readonly UiMode[] = ['light', 'dark', 'system']

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
  const html = document.documentElement
  html.dataset.theme = dark ? 'dark' : 'light'
  html.classList.toggle('dark', dark)
}

/** Switch the live theme, e.g. right after the preference was saved. */
export function applyUiMode(mode: UiMode) {
  current = mode
  repaint()
}

/**
 * Apply the boot-config mode before mount and follow OS scheme changes while
 * in "system" mode. index.html ships with data-theme="dark" pre-set, so dark users (the
 * default) never see a theme change here.
 */
export function initUiMode() {
  systemDark.addEventListener('change', repaint)
  applyUiMode(config.uiMode)
}
