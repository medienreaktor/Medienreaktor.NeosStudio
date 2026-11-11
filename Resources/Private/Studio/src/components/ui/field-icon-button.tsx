import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * The small, muted icon button that sits inside or beside a field: a text
 * editor's apply / revert, a selected entry's remove, a reference's "go to".
 * Quieter than a ghost Button - muted until hovered - so a field with several
 * entries does not turn into a column of heavy buttons.
 *
 * `keepFocus` cancels pointerdown so the click leaves the focus (and caret)
 * where it is, and takes the button out of the tab order - for buttons that
 * act on the focused field and have a keyboard equivalent.
 */
export function FieldIconButton({
  icon,
  label,
  keepFocus = false,
  className,
  ...props
}: Omit<React.ComponentProps<'button'>, 'children'> & {
  /** Font Awesome icon name, e.g. "fa-xmark". */
  icon: string
  label: string
  keepFocus?: boolean
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...(keepFocus && {
        tabIndex: -1,
        onPointerDown: (event: React.PointerEvent) => event.preventDefault(),
        onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
      })}
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <i className={cn('fas type-icon-m', icon)} aria-hidden />
    </button>
  )
}
