import * as React from 'react'
import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer'

import { cn } from '@/lib/utils'

/**
 * Right-side floating drawer on Base UI's native Drawer: inset from the
 * viewport edges with rounded corners and a shadow. Non-modal use (page stays
 * fully interactive) is a first-class mode: set `modal={false}` and
 * `disablePointerDismissal` on the root. Drawers nest natively - render
 * another <Drawer> inside an open drawer's content. Override the margins via
 * className on DrawerContent to inset it further (e.g. below a header).
 */
function Drawer({
  swipeDirection = 'right',
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return (
    <DrawerPrimitive.Root
      data-slot="drawer"
      swipeDirection={swipeDirection}
      {...props}
    />
  )
}

/** Alias kept for call sites that want to make nesting explicit. */
const DrawerNested = Drawer

function DrawerTrigger({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerPortal({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />
}

function DrawerClose({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Backdrop>) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-overlay"
      className={cn(
        'fixed inset-0 z-200 bg-black/50 transition-opacity duration-300 data-starting-style:opacity-0 data-ending-style:opacity-0',
        className,
      )}
      {...props}
    />
  )
}

function DrawerContent({
  className,
  children,
  showOverlay = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Popup> & {
  /** Disable for non-modal drawers, where the page behind stays interactive. */
  showOverlay?: boolean
}) {
  return (
    <DrawerPortal>
      {showOverlay && <DrawerOverlay />}
      <DrawerPrimitive.Viewport className="pointer-events-none fixed inset-0 z-200 flex items-stretch justify-end">
        <DrawerPrimitive.Popup
          data-slot="drawer-content"
          className={cn(
            // mr-4 keeps the drawer clear of the page's scrollbar.
            'pointer-events-auto mt-2 mr-4 mb-2 flex w-96 max-w-[calc(100vw-3rem)] flex-col overflow-y-auto overscroll-contain rounded-lg border bg-neutral-900 text-white shadow-lg outline-none',
            // Swipe follows the pointer; open/close slide via the
            // starting/ending styles, close duration scaled by swipe strength.
            // The extra 1rem clears the right margin so the closed drawer
            // (and its shadow's origin) sits fully offscreen.
            'touch-auto transform-[translateX(var(--drawer-swipe-movement-x))] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            'data-swiping:select-none data-starting-style:transform-[translateX(calc(100%+1rem))] data-ending-style:transform-[translateX(calc(100%+1rem))] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*300ms)]',
            className,
          )}
          {...props}
        >
          <DrawerPrimitive.Content className="flex min-h-0 flex-1 flex-col">
            {children}
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPortal>
  )
}

function DrawerHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-header"
      className={cn('flex flex-col gap-0.5 p-4', className)}
      {...props}
    />
  )
}

function DrawerFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn('mt-auto flex flex-col gap-2 p-4', className)}
      {...props}
    />
  )
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn('font-semibold text-white', className)}
      {...props}
    />
  )
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn('text-sm text-neutral-400', className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerNested,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
