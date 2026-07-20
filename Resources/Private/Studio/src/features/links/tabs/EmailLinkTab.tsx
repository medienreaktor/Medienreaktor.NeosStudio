import { useState } from 'react'

import { Input } from '@/components/ui/input'
import type { LinkTypeTabProps } from '../registry'

/** "E-Mail link": an address input stored as mailto:<address>. */
export function EmailLinkTab({ href, onChange }: LinkTypeTabProps) {
  const [address, setAddress] = useState(() =>
    href !== null ? href.replace(/^mailto:/i, '') : '',
  )

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-neutral-400" htmlFor="link-email-address">
        E-Mail address
      </label>
      <Input
        id="link-email-address"
        type="email"
        value={address}
        autoFocus
        onChange={(event) => {
          const raw = event.target.value
          setAddress(raw)
          const trimmed = raw.trim()
          onChange(trimmed === '' ? null : `mailto:${trimmed}`)
        }}
        placeholder="mail@example.com"
      />
      <p className="text-xs text-neutral-500">
        The link opens the visitor's mail client (mailto:).
      </p>
    </div>
  )
}
