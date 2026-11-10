import { Spinner } from '@/components/ui/spinner'
import { faClassName } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

/**
 * An action's icon: the configured Font Awesome name (any syntax `ui.icon`
 * accepts, resolved like the node decorators' icons), a spinner while the
 * action runs, and an empty fixed-width slot without an icon, so labels
 * stay aligned with the iconed items around them.
 */
export function ActionIcon({
  icon,
  busy = false,
}: {
  icon?: string
  busy?: boolean
}) {
  if (busy) return <Spinner className="fa-fw" />
  return (
    <i className={cn(icon ? faClassName(icon) : 'fa', 'fa-fw')} aria-hidden />
  )
}
