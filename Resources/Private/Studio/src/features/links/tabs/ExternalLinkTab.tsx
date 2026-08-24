import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { translate as t } from '@/lib/i18n'
import type { LinkTypeTabProps } from '../registry'

/**
 * A typed URL without a scheme gets https:// - "example.com" is what people
 * type, "https://example.com" is what the link must store. Anything already
 * carrying a scheme (https:, tel:, ftp:, ...) passes through verbatim.
 */
function normalizeExternalHref(raw: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
}

/**
 * "External link": a plain URL input. Also the fallback tab (see the
 * registry's isFallback): an href no type recognizes - a tel: link, say -
 * shows here verbatim for the user to correct.
 */
export function ExternalLinkTab({ href, onChange }: LinkTypeTabProps) {
  // What the user typed; the normalized href only travels upward, so the
  // input never rewrites under their fingers.
  const [text, setText] = useState(() => href ?? '')

  return (
    <div className="flex flex-col gap-1.5 p-3">
      <label className="text-xs text-neutral-600 dark:text-neutral-400" htmlFor="link-external-url">
        {t('link.url', 'URL')}
      </label>
      <Input
        id="link-external-url"
        type="url"
        value={text}
        autoFocus
        onChange={(event) => {
          const raw = event.target.value
          setText(raw)
          const trimmed = raw.trim()
          onChange(trimmed === '' ? null : normalizeExternalHref(trimmed))
        }}
        placeholder={t('link.urlPlaceholder', 'https://example.com')}
      />
      <p className="text-xs text-neutral-500">
        {t(
          'link.externalHelp',
          'A full web address; https:// is added when no scheme is given.',
        )}
      </p>
    </div>
  )
}
