import * as React from 'react'

/** Elements a label click should hand to the browser: it focuses them. */
const NATIVE_TARGETS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * A field's label, tied to its control by `htmlFor` - so the control is named
 * by it for assistive technology, and clicking the label focuses the control.
 *
 * Inputs, textareas and selects get the browser's own behaviour. Any other
 * target is focused, not clicked: a native label would CLICK a button
 * (opening the media picker or a dialog - not what a click on a field's name
 * should do), and does nothing for an element it cannot label (the rich text
 * editor's contenteditable).
 *
 * Triggers marked `data-label-opens` do open, like a native select's label
 * opens it. By default the keyboard's way - ArrowDown on the focused trigger
 * (the Select and Combobox primitives; Base UI opens them on mousedown, so a
 * click would not do); `data-label-opens="click"` clicks the trigger instead
 * (a popover trigger, e.g. the date picker's, which ArrowDown does not open).
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
        const opens = target.getAttribute('data-label-opens')
        if (opens === 'click') {
          target.click()
        } else if (opens !== null) {
          target.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'ArrowDown',
              code: 'ArrowDown',
              bubbles: true,
              cancelable: true,
            }),
          )
        }
      }}
      {...props}
    />
  )
}
