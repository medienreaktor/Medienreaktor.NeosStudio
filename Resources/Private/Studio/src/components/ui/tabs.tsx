import * as React from 'react'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'

import { cn } from '@/lib/utils'

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col', className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        // justify-start, not -center: centering an overflowing scroll
        // container puts the leading tabs outside the reachable scroll area,
        // so the list mounts "scrolled to the end" with no way back.
        // relative is load-bearing: Base UI scrolls the active tab into view
        // on mount by walking offsetParents up to this list — if the list is
        // position: static the walk overshoots to the page and scrollTo gets
        // a huge offset, pinning the list to the end.
        'scrollbar-none relative inline-flex h-9 w-fit max-w-full items-center justify-start overflow-x-auto text-neutral-600 dark:text-neutral-400',
        className,
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-full flex-1 items-center border-t border-transparent justify-center gap-1.5 px-2 py-1 text-sm font-medium whitespace-nowrap text-neutral-600 dark:text-neutral-400 transition-[color] focus-visible:border-blue-500 focus-visible:outline-1 focus-visible:outline-blue-500 disabled:pointer-events-none disabled:opacity-50 data-active:bg-neutral-50 data-active:border-neutral-300 dark:data-active:bg-neutral-900 dark:data-active:border-neutral-600 data-active:text-blue-500 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Panel>) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn(
        'flex-1 outline-none bg-neutral-50 dark:bg-neutral-900',
        className,
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
