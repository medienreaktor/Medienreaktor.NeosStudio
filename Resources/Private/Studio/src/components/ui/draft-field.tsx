import * as React from 'react'

import { FieldIconButton } from '@/components/ui/field-icon-button'
import { isMacPlatform } from '@/features/shortcuts/registry'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * A field holding a local draft that is saved explicitly (the inspector's text
 * editors, the asset metadata form): Enter / mod+Enter or the inline apply
 * button commits, Escape or the inline revert button throws the draft away.
 * Leaving the field does not save - instead the two buttons stay visible for
 * as long as the draft differs from the saved value, so an unsaved edit is
 * never silent.
 *
 * The buttons never take the focus (pointerdown is cancelled, tabIndex -1),
 * so typing can go on after either.
 *
 * Mark the element that must make room for the buttons with
 * `data-draft-target`. Inline placement (single-line inputs) pads it on the
 * right while the buttons show - a width change, no layout shift. Bottom
 * placement (textareas, rich text) reserves the strip at the bottom
 * permanently: padding that came and went would change the field's height.
 */
export function DraftField({
  dirty,
  placement = 'inline',
  multiline = placement === 'bottom',
  actions = true,
  onApply,
  onRevert,
  className,
  children,
}: {
  /** True while the draft differs from the saved value. */
  dirty: boolean
  /** 'inline': vertically centred at the right edge; 'bottom': bottom right. */
  placement?: 'inline' | 'bottom'
  /** Multi-line fields apply with mod+Enter (Enter inserts a newline). */
  multiline?: boolean
  /** False leaves the buttons out (and reserves no room for them). */
  actions?: boolean
  onApply: () => void
  onRevert: () => void
  className?: string
  children: React.ReactNode
}) {
  const applyKey = multiline ? (isMacPlatform ? '⌘↵' : 'Ctrl+↵') : '↵'
  return (
    <div
      className={cn(
        'relative',
        actions &&
          (placement === 'inline'
            ? dirty && '[&_[data-draft-target]]:pr-14'
            : '[&_[data-draft-target]]:pb-8'),
        className,
      )}
    >
      {children}
      {actions && dirty && (
        <div
          className={cn(
            'absolute right-1 z-10 flex items-center gap-0.5',
            placement === 'inline' ? 'top-1/2 -translate-y-1/2' : 'bottom-1',
          )}
        >
          <FieldIconButton
            keepFocus
            icon="fa-check"
            label={t('editor.draft.apply', 'Apply ({0})', [applyKey])}
            onClick={onApply}
            className="text-primary-text"
          />
          <FieldIconButton
            keepFocus
            icon="fa-rotate-left"
            label={t('editor.draft.revert', 'Revert ({0})', ['Esc'])}
            onClick={onRevert}
          />
        </div>
      )}
    </div>
  )
}

/** True for the multi-line "apply" chord: mod+Enter. */
export function isApplyChord(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>,
): boolean {
  return (
    event.key === 'Enter' && (isMacPlatform ? event.metaKey : event.ctrlKey)
  )
}
