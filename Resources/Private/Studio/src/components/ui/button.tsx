import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from '@/lib/slot'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md type-body-strong whitespace-nowrap transition-all outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20',
        outline: 'border border-border bg-input/30 hover:bg-input/50 shadow-xs',
        secondary: 'bg-secondary text-foreground hover:bg-accent/80',
        ghost: 'hover:bg-accent hover:text-foreground',
        link: 'text-primary-text underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8.5 px-3.5 py-2 has-[>svg]:px-3',
        xs: "h-5.5 gap-1 rounded-md px-2 type-small-strong has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-7.5 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-9.5 rounded-md px-5.5 has-[>svg]:px-3.5',
        icon: 'size-8.5',
        'icon-xs': "size-5.5 rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-7.5',
        'icon-lg': 'size-9.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  type,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      // Default to "button", not the native "submit": a Button dropped into a
      // <form> (e.g. an editor's "Select…" inside the creation dialog) must not
      // submit it on click. Real submit buttons opt in with type="submit".
      type={asChild ? type : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button }
