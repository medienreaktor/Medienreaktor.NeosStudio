import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'

import { cn } from '@/lib/utils'

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded text-sm whitespace-nowrap text-neutral-300 outline-none focus-visible:outline-1 focus-visible:outline-blue-500 disabled:pointer-events-none disabled:text-neutral-600 not-data-pressed:hover:bg-neutral-700 data-pressed:bg-blue-500 data-pressed:text-white [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline:
          'border border-neutral-700 bg-transparent not-data-pressed:hover:bg-neutral-800',
      },
      size: {
        default: 'h-9 min-w-9 px-2',
        sm: 'h-8 min-w-8 px-1.5',
        lg: 'h-10 min-w-10 px-2.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
