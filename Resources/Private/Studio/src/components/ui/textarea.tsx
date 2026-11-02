import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-15 w-full rounded-md border border-border bg-input/30 px-3 py-2 type-default shadow-xs transition-[color,box-shadow] outline-none placeholder:text-placeholder focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/30 md:type-body',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
