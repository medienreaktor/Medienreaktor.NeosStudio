import { useId, useState } from 'react'

import { Input } from '@/components/ui/input'
import { translate as t } from '@/lib/i18n'
import { parseExternalHref, type ExternalHrefError } from '../linkValue'
import type { LinkTypeTabProps } from '../registry'

/** The inline error for a typed link that can't be stored. */
function errorText(error: ExternalHrefError): string | null {
  switch (error.kind) {
    case 'empty':
      return null
    case 'whitespace':
      return t(
        'link.urlWhitespace',
        'A web address cannot contain spaces - remove them or encode them as %20.',
      )
    case 'second_scheme':
      return t(
        'link.urlSecondScheme',
        'This looks like two addresses in one - keep only one of them.',
      )
    case 'scheme_not_allowed':
      return t(
        'link.schemeNotAllowed',
        'This kind of link is not allowed - use http(s), mailto, tel or a relative link.',
      )
    case 'unparsable':
      return t('link.urlInvalid', 'This is not a valid web address.')
  }
}

/**
 * "External link": a plain URL input. Also the fallback tab (see the
 * registry's isFallback): an href no type recognizes - a tel: link, say -
 * shows here verbatim for the user to correct. Only an href parseExternalHref
 * accepts is reported upward; anything else (javascript:, two URLs pasted
 * into one, spaces, ...) shows an inline error and leaves nothing to apply.
 */
export function ExternalLinkTab({ href, onChange }: LinkTypeTabProps) {
  const id = useId()
  // What the user typed; the normalized href only travels upward, so the
  // input never rewrites under their fingers.
  const [text, setText] = useState(() => href ?? '')
  const parsed = parseExternalHref(text)
  const error = parsed.ok ? null : errorText(parsed.error)

  return (
    <div className="flex flex-col gap-1.5 p-3">
      <label className="type-small text-muted-foreground" htmlFor={id}>
        {t('link.url', 'URL')}
      </label>
      <Input
        id={id}
        type="url"
        value={text}
        autoFocus
        aria-invalid={error !== null || undefined}
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          const raw = event.target.value
          setText(raw)
          const next = parseExternalHref(raw)
          onChange(next.ok ? next.href : null)
        }}
        placeholder={t('link.urlPlaceholder', 'https://example.com')}
      />
      {error !== null ? (
        <p id={`${id}-hint`} className="type-small text-destructive-text">
          {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className="type-small text-muted-foreground">
          {t(
            'link.externalHelp',
            'A full web address; https:// is added when no scheme is given.',
          )}
        </p>
      )}
    </div>
  )
}
