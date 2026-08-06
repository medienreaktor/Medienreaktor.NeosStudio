import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from '@/lib/slot'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-blue-500 focus-visible:ring-[3px] focus-visible:ring-blue-500/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-red-500 aria-invalid:ring-red-500/20 dark:aria-invalid:ring-red-500/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-blue-500 text-white hover:bg-blue-500/90',
        destructive:
          'bg-red-500 text-white hover:bg-red-500/90 focus-visible:ring-red-500/20 dark:bg-red-500/60 dark:focus-visible:ring-red-500/40',
        outline:
          'border border-neutral-300 dark:border-neutral-700 bg-neutral-300/30 hover:bg-neutral-300/50 dark:bg-neutral-700/30 dark:hover:bg-neutral-700/50 shadow-xs',
        secondary: 'bg-neutral-200 dark:bg-neutral-800 text-neutral-950 dark:text-white hover:bg-neutral-200/80 dark:hover:bg-neutral-800/80',
        ghost:
          'hover:bg-neutral-200 hover:text-neutral-950 dark:hover:bg-neutral-800/50 dark:hover:text-white',
        link: 'text-blue-500 underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
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

export { Button, buttonVariants }
