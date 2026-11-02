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
        'flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-5.5 text-center text-muted-foreground',
        className,
      )}
      {...props}
    >
      {icon && (
        <i
          className={cn('fas type-icon-3xl text-placeholder', icon)}
          aria-hidden
        />
      )}
      <p className="max-w-90 type-small leading-relaxed">{title}</p>
      {children}
    </div>
  )
}

export { Placeholder }
