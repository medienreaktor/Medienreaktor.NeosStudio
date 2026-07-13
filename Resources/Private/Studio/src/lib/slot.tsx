import * as React from 'react'
import { mergeProps } from '@base-ui/react/merge-props'

/**
 * Minimal replacement for Radix's Slot, used by the vendored shadcn
 * components' asChild prop: merges the slot's props onto its single child
 * element (className/style merged, handlers chained via Base UI's
 * mergeProps). Refs are not merged - none of our asChild usages need that.
 */
function SlotRoot({ children, ...props }: React.HTMLAttributes<HTMLElement>) {
  if (React.isValidElement(children)) {
    return React.cloneElement(
      children,
      mergeProps(props, children.props as Record<string, unknown>),
    )
  }
  return null
}

export const Slot = { Root: SlotRoot }
