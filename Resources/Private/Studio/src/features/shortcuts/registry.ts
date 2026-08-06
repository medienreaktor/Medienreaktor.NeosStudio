/**
 * The keyboard-shortcut registry: every shortcut - built-in or third-party -
 * registers here, and one window-level dispatcher (see ShortcutHost) routes
 * keydown events to the matching handler. Modelled on the panel and modal
 * registries: a small observable store, register-replaces-by-id so HMR and
 * plugin reloads stay idempotent, and a stable snapshot for
 * useSyncExternalStore (the shortcut overview dialog renders it).
 *
 * ## The unified accessor
 *
 * Studio shortcuts share one accessor: mod+shift (⌘⇧ on macOS, Ctrl+Shift
 * elsewhere). It is the only modifier family that is safe everywhere we need
 * it to be: it never produces text (unlike Shift or Option, so it works
 * during inline editing and in inputs), it dodges the single-modifier
 * browser/OS menu shortcuts (⌘B, ⌘,), and it survives non-US layouts
 * (Option and AltGr carry everyday characters on German keyboards).
 * Declare shortcuts with `key: 'p'` - a single letter or digit - and the
 * registry binds the accessor itself; consistency is structural, not a
 * convention. Letters/digits only: symbol keys move between layouts (a
 * German '/' is Shift+7) and shifted symbols collide with system shortcuts
 * (⌘⇧/ is macOS Help-menu search).
 *
 * Some accessor keys never reach the page and are rejected at registration
 * (see RESERVED_ACCESSOR_KEYS). Others shadow browser shortcuts the page IS
 * allowed to take over (capture-phase dispatch preventDefault()s them):
 * 'r' (hard reload - shadowed deliberately by the preview), 'b' (Chrome
 * bookmarks bar), 'p' (Firefox private window / Safari print), 'o'
 * (bookmark managers). Shadowing is a per-shortcut judgement call; the
 * reserved list is not.
 *
 * ## Raw combos (the escape hatch)
 *
 * `combo` bypasses the accessor for the few sanctioned exceptions where a
 * universal convention beats consistency (⇧? for the shortcut overview -
 * the Gmail/GitHub/Slack help key). New shortcuts should use `key`.
 * Combos are '+'-joined tokens, e.g. 'mod+shift+p' or 'shift+?'. Recognised
 * modifiers: 'mod' (⌘ on macOS, Ctrl elsewhere), 'ctrl', 'meta',
 * 'alt'/'option', 'shift'. The final token is the key as reported by
 * KeyboardEvent.key ('p', '/', 'escape', 'arrowup', 'f5', ...). Because
 * matching uses event.key, declare shifted symbols as the symbol the shift
 * produces ('shift+?' not 'shift+/'). Layouts differ in which symbols need
 * Shift at all (a German '/' is Shift+7): when a symbol key arrives with
 * Shift held, dispatch retries the match without it, so 'mod+/' fires for
 * Ctrl+Shift+7 on a German layout just like for Ctrl+/ on a US one.
 *
 * Scope: shortcuts fire on the Studio shell's own window. Keystrokes inside
 * the preview iframe stay with the guest frame (inline editing owns them).
 */

export interface KeyboardShortcutDefinition {
  /** Unique id, e.g. 'workspace.publish'. Third-party shortcuts should namespace ('vendor.package:my-shortcut'). */
  id: string
  /**
   * The preferred way to bind: a single letter or digit, bound under the
   * unified accessor as mod+shift+<key>. Rejected (with a console warning)
   * for keys the browser never hands over - see RESERVED_ACCESSOR_KEYS.
   */
  key?: string
  /**
   * Raw combo(s), e.g. 'shift+?' or ['mod+/', 'shift+?'] - the escape hatch
   * for sanctioned exceptions to the accessor scheme. Ignored when `key` is
   * set. One of `key` or `combo` is required.
   */
  combo?: string | string[]
  /** Human-readable action name, shown in the shortcut overview. */
  title: string
  /** Overview grouping label; shortcuts sharing a category list together. */
  category?: string
  /**
   * Runs on a matching keydown. Return false to decline ("nothing to do
   * here") - dispatch then falls through to the next registered shortcut on
   * the same combo, and finally back to the browser. Any other return value
   * counts as handled and the event is preventDefault()ed.
   */
  handler: (event: KeyboardEvent) => void | boolean
  /**
   * Fire even while focus is in an input, textarea, select or contenteditable.
   * Defaults to true for `key`-based shortcuts (the accessor never types
   * text, so they are always input-safe) and false for raw combos - those
   * must opt in, plain-key combos must not swallow typing.
   */
  allowInInput?: boolean
  /** Extra guard consulted at dispatch time; false skips this shortcut. */
  when?: () => boolean
}

/**
 * A registered shortcut always carries its resolved combo (`key` expanded to
 * 'mod+shift+<key>' at registration) - what dispatch and the overview use.
 */
export type ResolvedKeyboardShortcut = KeyboardShortcutDefinition & {
  combo: string | string[]
}

/**
 * Accessor keys the browser consumes before the page sees them - no
 * capture-phase preventDefault can reclaim these, so binding them would
 * silently do nothing (or only work on one platform). Rejected at
 * registration:
 * - n / t / w: new (incognito/private) window, reopen closed tab, close
 *   window - hard-reserved in every browser.
 * - i / j / c: DevTools, console, inspect-element on Windows/Linux Chrome,
 *   not interceptable there; a unified binding must work on every platform.
 */
const RESERVED_ACCESSOR_KEYS = new Set(['n', 't', 'w', 'i', 'j', 'c'])

export const isMacPlatform: boolean =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

const MODIFIERS = new Set([
  'mod',
  'ctrl',
  'control',
  'meta',
  'cmd',
  'alt',
  'option',
  'shift',
])

/**
 * Canonical form of a combo: 'alt+ctrl+meta+shift+<key>' with 'mod' resolved
 * to the platform's primary modifier. Null for an unparseable combo.
 */
export function normalizeCombo(combo: string): string | null {
  const tokens = combo
    .toLowerCase()
    .split('+')
    .map((token) => token.trim())
  // '+' itself as the key ('mod++') survives as an empty final token.
  const key = tokens[tokens.length - 1] === '' ? '+' : tokens[tokens.length - 1]
  if (!key || MODIFIERS.has(key)) return null
  const mods = { alt: false, ctrl: false, meta: false, shift: false }
  for (const token of tokens.slice(0, -1)) {
    if (token === 'mod') mods[isMacPlatform ? 'meta' : 'ctrl'] = true
    else if (token === 'ctrl' || token === 'control') mods.ctrl = true
    else if (token === 'meta' || token === 'cmd') mods.meta = true
    else if (token === 'alt' || token === 'option') mods.alt = true
    else if (token === 'shift') mods.shift = true
    else return null
  }
  return (
    (mods.alt ? 'alt+' : '') +
    (mods.ctrl ? 'ctrl+' : '') +
    (mods.meta ? 'meta+' : '') +
    (mods.shift ? 'shift+' : '') +
    key
  )
}

/** The canonical combo a keydown event represents (its key in event.key form). */
export function comboFromEvent(event: KeyboardEvent): string {
  return (
    (event.altKey ? 'alt+' : '') +
    (event.ctrlKey ? 'ctrl+' : '') +
    (event.metaKey ? 'meta+' : '') +
    (event.shiftKey ? 'shift+' : '') +
    event.key.toLowerCase()
  )
}

/** True when typing belongs to the focused element, not to shortcuts. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

const DISPLAY_KEYS: Record<string, string> = {
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  escape: 'Esc',
  enter: '↵',
  ' ': 'Space',
  backspace: '⌫',
  delete: 'Del',
}

/**
 * A combo formatted for display, one token per array entry (render each as
 * its own <kbd>): ['⌘', '⇧', 'P'] on macOS, ['Ctrl', 'Shift', 'P'] elsewhere.
 */
export function formatCombo(combo: string): string[] {
  const canonical = normalizeCombo(combo)
  if (!canonical) return [combo]
  const tokens = canonical.split('+')
  const key = tokens[tokens.length - 1] === '' ? '+' : tokens[tokens.length - 1]
  const parts: string[] = []
  for (const mod of tokens.slice(0, -1)) {
    if (mod === 'ctrl') parts.push(isMacPlatform ? '⌃' : 'Ctrl')
    else if (mod === 'alt') parts.push(isMacPlatform ? '⌥' : 'Alt')
    else if (mod === 'shift') parts.push(isMacPlatform ? '⇧' : 'Shift')
    else if (mod === 'meta') parts.push(isMacPlatform ? '⌘' : 'Meta')
  }
  parts.push(
    DISPLAY_KEYS[key] ??
      (key.length === 1
        ? key.toUpperCase()
        : key[0].toUpperCase() + key.slice(1)),
  )
  return parts
}

export class KeyboardShortcutRegistry {
  private definitions = new Map<string, ResolvedKeyboardShortcut>()
  private listeners = new Set<() => void>()
  private snapshot: ResolvedKeyboardShortcut[] = []
  /** canonical combo → definitions listening on it, in registration order. */
  private byCombo = new Map<string, ResolvedKeyboardShortcut[]>()

  /** Registering an already-known id replaces it, so HMR and plugin reloads stay idempotent. */
  register(definition: KeyboardShortcutDefinition): void {
    const resolved = resolveDefinition(definition)
    if (!resolved) return
    this.definitions.set(resolved.id, resolved)
    this.emit()
  }

  unregister(id: string): void {
    if (this.definitions.delete(id)) this.emit()
  }

  get(id: string): ResolvedKeyboardShortcut | undefined {
    return this.definitions.get(id)
  }

  /** Stable snapshot in registration order - changes identity only on (un)register. */
  getAll(): ResolvedKeyboardShortcut[] {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Route a keydown to the matching shortcut. Later registrations win on a
   * combo conflict (plugins load after built-ins, so a plugin can override);
   * a handler returning false falls through to the next match. Returns true -
   * and has preventDefault()ed - when some handler took the event.
   */
  dispatch(event: KeyboardEvent): boolean {
    if (event.repeat) return false
    const combo = comboFromEvent(event)
    if (this.dispatchTo(this.byCombo.get(combo), event)) return true
    // On layouts where a symbol lives on a shifted key (German '/' is
    // Shift+7), the Shift is part of typing the character, not part of the
    // combo - retry symbol keys without it. Letters are excluded: there
    // Shift is always a deliberate combo modifier.
    const key = event.key.toLowerCase()
    if (event.shiftKey && key.length === 1 && (key < 'a' || key > 'z')) {
      return this.dispatchTo(
        this.byCombo.get(combo.replace('shift+', '')),
        event,
      )
    }
    return false
  }

  private dispatchTo(
    matches: ResolvedKeyboardShortcut[] | undefined,
    event: KeyboardEvent,
  ): boolean {
    if (!matches) return false
    const editable = isEditableTarget(event.target)
    for (let i = matches.length - 1; i >= 0; i--) {
      const definition = matches[i]
      if (editable && !definition.allowInInput) continue
      if (definition.when && !definition.when()) continue
      if (definition.handler(event) === false) continue
      event.preventDefault()
      return true
    }
    return false
  }

  private emit(): void {
    this.snapshot = [...this.definitions.values()]
    this.byCombo = new Map()
    for (const definition of this.snapshot) {
      const combos = Array.isArray(definition.combo)
        ? definition.combo
        : [definition.combo]
      for (const combo of combos) {
        const canonical = normalizeCombo(combo)
        if (!canonical) {
          console.warn(
            `[NeosStudio] Ignoring unparseable shortcut combo "${combo}" (${definition.id})`,
          )
          continue
        }
        const list = this.byCombo.get(canonical)
        if (list) list.push(definition)
        else this.byCombo.set(canonical, [definition])
      }
    }
    this.listeners.forEach((listener) => listener())
  }
}

/**
 * Expand `key` into its accessor combo and apply the key-based defaults, or
 * pass a raw-combo definition through. Null (plus a console warning) for
 * definitions that must not bind: reserved or non-letter/digit accessor
 * keys, or neither `key` nor `combo` given.
 */
function resolveDefinition(
  definition: KeyboardShortcutDefinition,
): ResolvedKeyboardShortcut | null {
  if (definition.key !== undefined) {
    const key = definition.key.toLowerCase()
    if (!/^[a-z0-9]$/.test(key)) {
      console.warn(
        `[NeosStudio] Shortcut key must be a single letter or digit, got "${definition.key}" (${definition.id}) - not registered`,
      )
      return null
    }
    if (RESERVED_ACCESSOR_KEYS.has(key)) {
      console.warn(
        `[NeosStudio] Shortcut key "${key}" is browser-reserved and can never fire (${definition.id}) - not registered`,
      )
      return null
    }
    return { allowInInput: true, ...definition, combo: `mod+shift+${key}` }
  }
  if (definition.combo === undefined) {
    console.warn(
      `[NeosStudio] Shortcut needs a key or combo (${definition.id}) - not registered`,
    )
    return null
  }
  return definition as ResolvedKeyboardShortcut
}

export const keyboardShortcutRegistry = new KeyboardShortcutRegistry()
