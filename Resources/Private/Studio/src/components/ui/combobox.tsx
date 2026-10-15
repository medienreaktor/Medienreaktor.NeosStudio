import * as React from 'react'
import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'

import { cn } from '@/lib/utils'

/**
 * Base UI's Combobox, styled like the select. Pass `items` (flat, or groups
 * of { value, items }) to the root and render them through ComboboxList's
 * function child - or ComboboxGroup + ComboboxCollection for groups.
 */
function Combobox<Value, Multiple extends boolean | undefined = false>(
  props: ComboboxPrimitive.Root.Props<Value, Multiple>,
) {
  return <ComboboxPrimitive.Root {...props} />
}

/** A select-like button opening the popup (the input then sits inside it). */
function ComboboxTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Trigger>) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-300/30 hover:bg-neutral-300/50 dark:bg-neutral-700/30 dark:hover:bg-neutral-700/50 px-3 py-2 text-left text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-blue-500 focus-visible:ring-[3px] focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      <ComboboxPrimitive.Icon>
        <i
          className="fas fa-chevron-down text-[1rem] text-neutral-950/50 dark:text-white/50"
          aria-hidden
        />
      </ComboboxPrimitive.Icon>
    </ComboboxPrimitive.Trigger>
  )
}

/** The search input - inside the popup (a searchable select) or standalone. */
function ComboboxInput({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Input>) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-300/30 dark:bg-neutral-700/30 px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none selection:bg-blue-500 selection:text-white placeholder:text-neutral-400 focus-visible:border-blue-500 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

/** The popup, portalled and positioned below its anchor (the trigger or input). */
function ComboboxContent({
  className,
  children,
  side,
  align = 'start',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Popup> & {
  side?: React.ComponentProps<typeof ComboboxPrimitive.Positioner>['side']
  align?: React.ComponentProps<typeof ComboboxPrimitive.Positioner>['align']
  sideOffset?: number
}) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="z-200 outline-none"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            'max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) overflow-hidden rounded-md border bg-neutral-50 dark:bg-neutral-900 p-1 text-neutral-950 dark:text-white shadow-md transition-[opacity,scale] duration-150 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.List>) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        'max-h-64 overflow-y-auto overscroll-contain scroll-py-1 outline-none empty:hidden',
        className,
      )}
      {...props}
    />
  )
}

function ComboboxItem({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Item>) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        'flex w-full cursor-default items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden select-none data-highlighted:bg-neutral-200 dark:data-highlighted:bg-neutral-800 data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

function ComboboxGroup({
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Group>) {
  return <ComboboxPrimitive.Group data-slot="combobox-group" {...props} />
}

function ComboboxGroupLabel({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.GroupLabel>) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-group-label"
      className={cn(
        'px-2 py-1.5 text-xs text-neutral-600 dark:text-neutral-400',
        className,
      )}
      {...props}
    />
  )
}

const ComboboxCollection = ComboboxPrimitive.Collection

/** Shown when the list has no items. */
function ComboboxEmpty({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Empty>) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        'px-2 text-xs text-neutral-600 empty:hidden dark:text-neutral-400 [&:not(:empty)]:py-2',
        className,
      )}
      {...props}
    />
  )
}

/** A live region for loading and result messages. */
function ComboboxStatus({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Status>) {
  return (
    <ComboboxPrimitive.Status
      data-slot="combobox-status"
      className={cn(
        'flex items-center gap-2 px-2 text-xs text-neutral-600 empty:hidden dark:text-neutral-400 [&:not(:empty)]:py-2',
        className,
      )}
      {...props}
    />
  )
}

export {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxStatus,
  ComboboxTrigger,
}
