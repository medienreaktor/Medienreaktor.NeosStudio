import * as React from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'

import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

function Dialog({
  open,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  // Base UI skips the enter transition when a dialog mounts with open
  // already true (useTransitionStatus initializes mounted = open, so the
  // starting-style state never applies). Render one closed frame first so
  // dialogs that mount open still fade in.
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      open={open === undefined ? undefined : open && mounted}
      {...props}
    />
  )
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Backdrop>) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-200 bg-white/90 dark:bg-neutral-950/80 transition-opacity duration-200 data-starting-style:opacity-0 data-ending-style:opacity-0',
        className,
      )}
      {...props}
    />
  )
}

const dialogSizes = {
  /** Compact dialogs: confirmations, renames, short decision prompts */
  sm: 'max-w-md',
  /** Working dialogs: node creation, pickers, editors */
  lg: 'max-w-2xl',
  /** Reading dialogs: review changes with inline diffs */
  xl: 'max-w-4xl',
} as const

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = 'sm',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup> & {
  showCloseButton?: boolean
  size?: keyof typeof dialogSizes
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // grid-cols-[minmax(0,1fr)] is load-bearing: the implicit column of
          // a bare `grid` is auto-sized, which resolves to MAX-content and
          // grows past the dialog's own max-width as soon as one child does
          // not fit - a wide tab strip, a long unbreakable string, a table.
          // Every child then stretches to that oversized track and spills out
          // to the right of the dialog's box, visibly so for anything with a
          // background or border. Capping the track at 1fr keeps it inside
          // the padding box, so those children scroll or wrap instead.
          'fixed top-1/2 left-1/2 z-200 grid w-full grid-cols-[minmax(0,1fr)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 p-6 shadow-lg transition-[opacity,transform] duration-200 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0',
          dialogSizes[size],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
            <i className="fas fa-xmark text-[1rem]" aria-hidden />
            <span className="sr-only">{t('common.close', 'Close')}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1.5', className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end',
        className,
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        'text-lg font-semibold text-neutral-950 dark:text-white',
        className,
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'text-sm text-neutral-600 dark:text-neutral-400',
        className,
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
