import * as React from 'react'

import { cn } from '@/lib/utils'
import { Input } from './input'

/**
 * The panel toolbars' search/filter field: an Input with a leading
 * magnifying-glass icon. Grows inside a flex row by default
 * (min-w-0 flex-1 on the wrapper).
 */
function SearchInput({
  className,
  wrapperClassName,
  ...props
}: React.ComponentProps<typeof Input> & { wrapperClassName?: string }) {
  return (
    <div className={cn('relative min-w-0 flex-1', wrapperClassName)}>
      <i
        className="fas fa-magnifying-glass pointer-events-none absolute z-10 top-1/2 left-2.5 -translate-y-1/2 text-xs text-neutral-600 dark:text-neutral-400"
        aria-hidden
      />
      <Input type="search" className={cn('h-8 pl-8', className)} {...props} />
    </div>
  )
}

export { SearchInput }
