import { useId, type ReactNode } from 'react'

/**
 * Labeled form field: a block label above its control, the shared shape of
 * every settings/dialog form (profile, user administration, ...). Pass
 * htmlFor when the child is a single labelable control; without it the field
 * is a group of controls (a checkbox list, say), named by its label through
 * role="group" + aria-labelledby - a <label> can only name one control.
 */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
}) {
  const labelId = useId()
  const labelClassName =
    'block text-sm font-medium text-neutral-800 dark:text-neutral-200'

  if (htmlFor === undefined) {
    return (
      <div role="group" aria-labelledby={labelId} className="space-y-1.5">
        <div id={labelId} className={labelClassName}>
          {label}
        </div>
        {children}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className={labelClassName}>
        {label}
      </label>
      {children}
    </div>
  )
}

export { Field }
