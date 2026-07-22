import type { ReactNode } from 'react'

/**
 * Labeled form field: a block label above its control, the shared shape of
 * every settings/dialog form (profile, user administration, ...). Pass
 * htmlFor when the child is a single labelable control.
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
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-neutral-200"
      >
        {label}
      </label>
      {children}
    </div>
  )
}

export { Field }
