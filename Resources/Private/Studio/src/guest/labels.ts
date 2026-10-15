/**
 * The guest's UI strings. The guest is a standalone bundle without the
 * shell's translation store, so the shell translates for it: the guest
 * announces its catalogue (label key → English fallback) in guest-ready, the
 * host answers with the translated values in init. Until init arrives - and
 * for any key the host does not translate - the English fallback shows.
 *
 * Elements created before init carry their key (see {@link applyLabel}) and
 * are relabelled once the translations arrive; everything rendered later
 * reads the translated value directly.
 */

/** Static UI strings of the guest's own chrome (toolbar items add theirs). */
export const GUEST_LABELS = {
  'element.options': 'Element options',
  'element.create': 'Create new element',
  'collection.add': 'Add content',
  'image.select': 'Select image',
  'variant.create': 'Create variant',
  'presence.editing': '{name} is editing',
} as const

export type GuestLabelKey = keyof typeof GUEST_LABELS

const fallbacks = new Map<string, string>(Object.entries(GUEST_LABELS))
let translations: Record<string, string> = {}

/**
 * The (translated) text for a key. `fallback` registers non-static keys
 * (toolbar items) on first use; {name}-style placeholders take `args`.
 */
export function label(
  key: string,
  fallback?: string,
  args?: Record<string, string>,
): string {
  if (fallback !== undefined && !fallbacks.has(key))
    fallbacks.set(key, fallback)
  const text = translations[key] ?? fallbacks.get(key) ?? fallback ?? key
  if (!args) return text
  return text.replace(
    /\{(\w+)\}/g,
    (match, name: string) => args[name] ?? match,
  )
}

/** Register more catalogue entries (key → English fallback). */
export function registerLabels(entries: Record<string, string>): void {
  for (const [key, fallback] of Object.entries(entries))
    if (!fallbacks.has(key)) fallbacks.set(key, fallback)
}

/** The catalogue the host is asked to translate (sent with guest-ready). */
export function labelCatalogue(): Record<string, string> {
  return Object.fromEntries(fallbacks)
}

const LABEL_KEY = 'neosStudioLabel'
const LABEL_TARGETS = 'neosStudioLabelTargets'

type LabelTarget = 'text' | 'aria-label' | 'title'

/**
 * Label an element (its text, aria-label and/or title) and remember the key
 * on it, so init can relabel it once the translations arrive.
 */
export function applyLabel(
  element: HTMLElement,
  key: GuestLabelKey,
  targets: LabelTarget[],
): void {
  element.dataset[LABEL_KEY] = key
  element.dataset[LABEL_TARGETS] = targets.join(' ')
  const text = label(key)
  for (const target of targets) {
    if (target === 'text') element.textContent = text
    else element.setAttribute(target, text)
  }
}

/** Take the host's translations and relabel what is already on the page. */
export function setTranslations(labels: Record<string, string>): void {
  translations = labels
  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-neos-studio-label]',
  )) {
    const key = element.dataset[LABEL_KEY] as GuestLabelKey
    const targets = (element.dataset[LABEL_TARGETS] ?? '').split(' ')
    applyLabel(element, key, targets.filter(Boolean) as LabelTarget[])
  }
}
