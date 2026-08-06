import { cn } from '@/lib/utils'

/**
 * An empty-state placeholder centered both axes inside its container. Fills the
 * available space (flex-1) so it drops straight into a panel, an editor slot or
 * a list that has nothing to show. An optional FontAwesome icon sits above the
 * message; pass `children` for actions (e.g. a button) below it.
 */
function Placeholder({
  icon,
  title,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  icon?: string
  title: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-neutral-600 dark:text-neutral-400',
        className,
      )}
      {...props}
    >
      {icon && (
        <i
          className={cn('fas text-[1.75rem] text-neutral-400 dark:text-neutral-600', icon)}
          aria-hidden
        />
      )}
      <p className="max-w-[24rem] text-xs leading-relaxed">{title}</p>
      {children}
    </div>
  )
}

export { Placeholder }
