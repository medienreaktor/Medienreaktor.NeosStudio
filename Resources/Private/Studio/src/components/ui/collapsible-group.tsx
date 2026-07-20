import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The inspector-style collapsible section: an uppercase summary row with a
 * chevron that rotates when open, over a native details element. Shared by
 * the inspector's property groups and the node-creation surfaces (palette,
 * insertion dialog) so every "group" accordion looks the same. Separators
 * and outer padding are the caller's business (the inspector adds a
 * border-b and p-2 via className; the creation surfaces stay bare).
 *
 * Pass open (+ onOpenChange) for a controlled section; omit it and the
 * section manages itself starting from defaultOpen. The summary click is
 * always intercepted, so the DOM never toggles behind React's back.
 */
export function CollapsibleGroup({
  label,
  open,
  defaultOpen = true,
  onOpenChange,
  className,
  bodyClassName,
  children,
}: {
  /** Summary row content besides the chevron, e.g. an icon plus the label. */
  label: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const isOpen = open ?? uncontrolledOpen
  return (
    <details
      open={isOpen}
      className={cn('group/collapsible m-0', className)}
    >
      <summary
        className="flex py-2 cursor-pointer list-none items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-white select-none [&::-webkit-details-marker]:hidden"
        onClick={(event) => {
          event.preventDefault()
          setUncontrolledOpen(!isOpen)
          onOpenChange?.(!isOpen)
        }}
      >
        {label}
        <span className="ml-auto transition-transform group-open/collapsible:rotate-90">
          <i className="fas fa-chevron-right" aria-hidden />
        </span>
      </summary>
      <div className={cn('py-2', bodyClassName)}>{children}</div>
    </details>
  )
}
