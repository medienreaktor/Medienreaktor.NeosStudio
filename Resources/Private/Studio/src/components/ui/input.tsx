import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-300/30 dark:bg-neutral-700/30 px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-blue-500 selection:text-white file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-neutral-950 dark:file:text-white placeholder:text-neutral-400 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 text-sm',
        'focus-visible:border-blue-500',
        'aria-invalid:border-red-500 aria-invalid:ring-red-500/20 dark:aria-invalid:ring-red-500/40',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
