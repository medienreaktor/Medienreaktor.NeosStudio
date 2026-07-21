/**
 * The inline error line(s) under an invalid field - the one shared way
 * validation errors render, in the inspector and the creation dialog alike
 * (form validation stays inline; toasts are for async failures).
 */
export function ValidationErrors({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null
  return (
    <div role="alert" className="mt-1 space-y-0.5 text-xs text-red-500">
      {errors.map((error, index) => (
        <p key={index}>{error}</p>
      ))}
    </div>
  )
}
