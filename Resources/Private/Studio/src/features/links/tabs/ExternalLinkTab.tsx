import { useId, useState } from 'react'

import { Input } from '@/components/ui/input'
import { translate as t } from '@/lib/i18n'
import { hasScheme, isAllowedHref } from '../linkValue'
import type { LinkTypeTabProps } from '../registry'

/**
 * A typed URL without a scheme gets https:// - "example.com" is what people
 * type, "https://example.com" is what the link must store. Anything already
 * carrying a scheme (https:, tel:, ...) and relative links (/path, ?query,
 * #anchor, ./file) pass through verbatim.
 */
function normalizeExternalHref(raw: string): string {
  return hasScheme(raw) || /^[/?#.]/.test(raw) ? raw : `https://${raw}`
}

/**
 * "External link": a plain URL input. Also the fallback tab (see the
 * registry's isFallback): an href no type recognizes - a tel: link, say -
 * shows here verbatim for the user to correct. Only the allowed schemes (see
 * isAllowedHref) are reported upward; anything else (javascript:, data:, ...)
 * shows an inline error and leaves nothing to apply.
 */
export function ExternalLinkTab({ href, onChange }: LinkTypeTabProps) {
  const id = useId()
  // What the user typed; the normalized href only travels upward, so the
  // input never rewrites under their fingers.
  const [text, setText] = useState(() => href ?? '')
  const trimmed = text.trim()
  const refused =
    trimmed !== '' && !isAllowedHref(normalizeExternalHref(trimmed))

  return (
    <div className="flex flex-col gap-1.5 p-3">
      <label
        className="text-xs text-neutral-600 dark:text-neutral-400"
        htmlFor={id}
      >
        {t('link.url', 'URL')}
      </label>
      <Input
        id={id}
        type="url"
        value={text}
        autoFocus
        aria-invalid={refused || undefined}
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          const raw = event.target.value
          setText(raw)
          const next = raw.trim()
          const normalized = next === '' ? null : normalizeExternalHref(next)
          onChange(
            normalized !== null && isAllowedHref(normalized)
              ? normalized
              : null,
          )
        }}
        placeholder={t('link.urlPlaceholder', 'https://example.com')}
      />
      {refused ? (
        <p id={`${id}-hint`} className="text-xs text-red-500">
          {t(
            'link.schemeNotAllowed',
            'This kind of link is not allowed - use http(s), mailto, tel or a relative link.',
          )}
        </p>
      ) : (
        <p id={`${id}-hint`} className="text-xs text-neutral-500">
          {t(
            'link.externalHelp',
            'A full web address; https:// is added when no scheme is given.',
          )}
        </p>
      )}
    </div>
  )
}
