import * as React from 'react'
import { cn } from '@/lib/utils'

const VARIANTS = {
  /** Red attention bubble, e.g. pending changes pinned to a button corner. */
  alert: 'bg-red-500 text-white',
  /**
   * A faint wash of the surrounding text color (currentColor), so the count
   * fits any context - inside a colored button as well as in running text.
   */
  neutral: 'bg-current/15 text-current',
}

/**
 * Count bubble (pending changes, selections). Inline by default; pass
 * positioning classes (e.g. `absolute -top-2 -right-1`) to pin it to a
 * corner of a `relative` parent.
 */
function CountBadge({
  count,
  variant = 'alert',
  className,
  ...props
}: React.ComponentProps<'span'> & {
  count: number
  variant?: keyof typeof VARIANTS
}) {
  return (
    <span
      data-slot="count-badge"
      className={cn(
        'flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums',
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {count}
    </span>
  )
}

export { CountBadge }
