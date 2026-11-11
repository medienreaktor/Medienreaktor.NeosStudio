import * as React from 'react'

/** Elements a label click should hand to the browser: it focuses them. */
const NATIVE_TARGETS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * A field's label, tied to its control by `htmlFor` - so the control is named
 * by it for assistive technology, and clicking the label focuses the control.
 *
 * Inputs, textareas and selects get the browser's own behaviour. Any other
 * target is focused, never activated: a native label would CLICK a button
 * (opening the media picker, a select, a dialog - not what a click on a
 * field's name should do), and does nothing for an element it cannot label
 * (the rich text editor's contenteditable).
 */
export function FieldLabel({
  htmlFor,
  onClick,
  ...props
}: React.ComponentProps<'label'>) {
  return (
    <label
      htmlFor={htmlFor}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || !htmlFor) return
        const target = document.getElementById(htmlFor)
        if (!target || NATIVE_TARGETS.has(target.tagName)) return
        event.preventDefault()
        target.focus()
      }}
      {...props}
    />
  )
}
