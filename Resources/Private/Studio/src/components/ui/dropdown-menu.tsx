import * as React from 'react'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'

import { cn } from '@/lib/utils'

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Root>) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Trigger>) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  className,
  side,
  align = 'start',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Popup> & {
  side?: React.ComponentProps<typeof MenuPrimitive.Positioner>['side']
  align?: React.ComponentProps<typeof MenuPrimitive.Positioner>['align']
  sideOffset?: number
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="z-200 outline-none select-none"
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            'max-h-(--available-height) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-neutral-100 dark:bg-neutral-900 p-1 text-neutral-950 dark:text-white shadow-md transition-[opacity,scale] duration-150 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0',
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Group>) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.GroupLabel>) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      className={cn('px-2 py-1.5 text-xs text-neutral-600 dark:text-neutral-400', className)}
      {...props}
    />
  )
}

function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Item> & {
  variant?: 'default' | 'destructive'
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-neutral-200 data-highlighted:text-neutral-950 dark:data-highlighted:bg-neutral-800 dark:data-highlighted:text-white data-disabled:pointer-events-none data-disabled:opacity-50 data-[variant=destructive]:text-red-500 data-[variant=destructive]:data-highlighted:bg-red-500/10 data-[variant=destructive]:data-highlighted:text-red-500 dark:data-[variant=destructive]:data-highlighted:bg-red-500/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-neutral-600 dark:[&_svg:not([class*='text-'])]:text-neutral-400 data-[variant=destructive]:[&_svg:not([class*='text-'])]:text-red-500",
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      // Toggling one entry of a multi-select filter must keep the menu open
      // for the next toggle; Escape/outside-click close it.
      closeOnClick={false}
      className={cn(
        'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-highlighted:bg-neutral-200 dark:data-highlighted:bg-neutral-800 data-highlighted:text-neutral-950 dark:data-highlighted:text-white data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <MenuPrimitive.CheckboxItemIndicator>
          <i className="fas fa-check text-[0.65rem]" aria-hidden />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.SubmenuRoot>) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.SubmenuTrigger>) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-neutral-200 dark:data-highlighted:bg-neutral-800 data-highlighted:text-neutral-950 dark:data-highlighted:text-white data-popup-open:bg-neutral-200 dark:data-popup-open:bg-neutral-800 data-popup-open:text-neutral-950 dark:data-popup-open:text-white data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-neutral-600 dark:])]:text-neutral-400",
        className,
      )}
      {...props}
    >
      {children}
      <i
        className="fas fa-chevron-right ml-auto text-[0.65rem] text-neutral-950/50 dark:text-white/50"
        aria-hidden
      />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Popup>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="z-200 outline-none select-none"
        sideOffset={4}
        alignOffset={-4}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-sub-content"
          className={cn(
            'max-h-(--available-height) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-neutral-100 dark:bg-neutral-900 p-1 text-neutral-950 dark:text-white shadow-md transition-[opacity,scale] duration-150 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0',
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn(
        'pointer-events-none -mx-1 my-1 h-px bg-neutral-300 dark:bg-neutral-700',
        className,
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
}
