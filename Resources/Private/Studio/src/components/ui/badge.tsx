import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from '@/lib/slot'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-blue-500 focus-visible:ring-[3px] focus-visible:ring-blue-500/50 aria-invalid:border-red-500 aria-invalid:ring-red-500/20 dark:aria-invalid:ring-red-500/40 [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-blue-500 text-white [a&]:hover:bg-blue-500/90',
        secondary: 'bg-neutral-800 text-white [a&]:hover:bg-neutral-800/90',
        destructive:
          'bg-red-500 text-white focus-visible:ring-red-500/20 dark:bg-red-500/60 dark:focus-visible:ring-red-500/40 [a&]:hover:bg-red-500/90',
        outline:
          'border-neutral-700 text-white [a&]:hover:bg-neutral-800 [a&]:hover:text-white',
        ghost: '[a&]:hover:bg-neutral-800 [a&]:hover:text-white',
        link: 'text-blue-500 underline-offset-4 [a&]:hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span'

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
