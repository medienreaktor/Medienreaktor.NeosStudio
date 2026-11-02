import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { usePresence } from './PresenceContext'

/** How many avatars render before the rest collapse into a "+N" chip. */
const MAX_AVATARS = 5

/**
 * The colleagues currently in the collaborative session, as an avatar stack
 * next to the workspace switcher. No avatar images exist yet - colored
 * initial circles stand in (the same color/initials the tree markers and
 * preview outlines use, so a person is recognizable across the UI).
 */
export function PresenceAvatars() {
  const { active, peers } = usePresence()
  if (!active) return null

  if (peers.length === 0) {
    return
  }

  const shown = peers.slice(0, MAX_AVATARS)
  const overflow = peers.length - shown.length

  return (
    <div
      className="hidden @[60rem]:flex items-center -space-x-1.5"
      data-slot="presence-avatars"
    >
      {shown.map((peer) => (
        <Tooltip key={peer.userId}>
          {/* A button (Base UI's default trigger) so the name is reachable
              by keyboard and announced - a bare span takes no focus. */}
          <TooltipTrigger
            aria-label={peer.name}
            className="flex size-6.5 items-center justify-center rounded-full border-2 border-card type-count text-presence-foreground select-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ backgroundColor: peer.color }}
          >
            <span aria-hidden>{peer.initials}</span>
          </TooltipTrigger>
          <TooltipContent>{peer.name}</TooltipContent>
        </Tooltip>
      ))}
      {overflow > 0 && (
        <Tooltip>
          <TooltipTrigger className="flex size-6.5 items-center justify-center rounded-full border-2 border-card bg-border type-count text-foreground select-none outline-none focus-visible:ring-2 focus-visible:ring-ring">
            +{overflow}
          </TooltipTrigger>
          <TooltipContent>
            {peers
              .slice(MAX_AVATARS)
              .map((peer) => peer.name)
              .join(', ')}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
