import * as React from 'react'
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'

import { cn } from '@/lib/utils'

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-3.5 shrink-0 rounded-[4px] border border-border shadow-xs outline-none transition-shadow',
        'data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground',
        'focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <i className="fas fa-check type-icon-l" aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
