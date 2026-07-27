import { cn } from '@/lib/utils'
import { presenceColor, presenceInitials } from './presenceColors'

/**
 * A person as a circle: their avatar image where one exists, and initials on
 * their deterministic presence color where none does. Neos users have no
 * avatar image at all today, so the initials are what everybody sees - but the
 * `imageUrl` path is here so that changes in one place once they do.
 *
 * One component for every avatar in the Studio (own user menu, the presence
 * stack, the history logs) so the same person looks the same everywhere. Size
 * and font size come from `className` - the default is the 28px topbar avatar.
 */
export function UserAvatar({
  name,
  userId,
  imageUrl,
  className,
  title,
}: {
  /** Display name - the initials come from it, "?" when it is empty. */
  name: string
  /**
   * Stable identity behind the color pick, so a person keeps their color even
   * when their name is rendered differently. Falls back to the name for
   * subjects without an id (a system user, a client-credential session).
   */
  userId?: string | null
  imageUrl?: string | null
  className?: string
  title?: string
}) {
  const shared = cn(
    'flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-[0.65rem] font-semibold text-white select-none',
    className,
  )
  if (imageUrl != null && imageUrl !== '') {
    return (
      <img
        src={imageUrl}
        alt=""
        title={title ?? name}
        className={cn(shared, 'object-cover')}
      />
    )
  }
  return (
    <span
      title={title ?? name}
      className={shared}
      style={{ backgroundColor: presenceColor(userId || name) }}
    >
      {presenceInitials(name)}
    </span>
  )
}
