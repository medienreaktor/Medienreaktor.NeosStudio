import { useId, useState } from 'react'

import { Input } from '@/components/ui/input'
import { translate as t } from '@/lib/i18n'
import type { LinkTypeTabProps } from '../registry'

/** "E-Mail link": an address input stored as mailto:<address>. */
export function EmailLinkTab({ href, onChange }: LinkTypeTabProps) {
  const id = useId()
  const [address, setAddress] = useState(() =>
    href !== null ? href.replace(/^mailto:/i, '') : '',
  )

  return (
    <div className="flex flex-col gap-1.5 p-3">
      <label className="type-small text-muted-foreground" htmlFor={id}>
        {t('link.emailAddress', 'E-Mail address')}
      </label>
      <Input
        id={id}
        type="email"
        value={address}
        autoFocus
        onChange={(event) => {
          const raw = event.target.value
          setAddress(raw)
          const trimmed = raw.trim()
          onChange(trimmed === '' ? null : `mailto:${trimmed}`)
        }}
        placeholder={t('link.emailPlaceholder', 'mail@example.com')}
      />
      <p className="type-small text-muted-foreground">
        {t(
          'link.emailHelp',
          "The link opens the visitor's mail client (mailto:).",
        )}
      </p>
    </div>
  )
}
