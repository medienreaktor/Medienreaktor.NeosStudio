import { cn } from '@/lib/utils'

/**
 * A FontAwesome spinner. Inline by default; wrap it in <LoadingState> (below)
 * to fill and center its container.
 */
function Spinner({ className, ...props }: React.ComponentProps<'i'>) {
  return (
    <i
      aria-hidden
      className={cn('fas fa-circle-notch fa-spin', className)}
      {...props}
    />
  )
}

/**
 * A loading indicator centered both axes inside its container. Fills the
 * available space (flex-1) so it can drop straight into a panel or an empty
 * editor slot. Optionally shows a label beneath the spinner.
 */
function LoadingState({
  label,
  className,
  spinnerClassName,
  ...props
}: React.ComponentProps<'div'> & {
  label?: string
  spinnerClassName?: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-neutral-400',
        className,
      )}
      {...props}
    >
      <Spinner className={cn('text-[1.5rem]', spinnerClassName)} />
      {label && <p className="text-xs">{label}</p>}
    </div>
  )
}

export { Spinner, LoadingState }
