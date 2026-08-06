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
      className="hidden @[56rem]:flex items-center -space-x-1.5"
      data-slot="presence-avatars"
    >
      {shown.map((peer) => (
        <Tooltip key={peer.userId}>
          <TooltipTrigger asChild>
            <span
              className="flex size-7 items-center justify-center rounded-full border-2 border-neutral-100 dark:border-neutral-900 text-[0.65rem] font-semibold text-white select-none"
              style={{ backgroundColor: peer.color }}
            >
              {peer.initials}
            </span>
          </TooltipTrigger>
          <TooltipContent>{peer.name}</TooltipContent>
        </Tooltip>
      ))}
      {overflow > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex size-7 items-center justify-center rounded-full border-2 border-neutral-100 dark:border-neutral-900 bg-neutral-300 dark:bg-neutral-700 text-[0.65rem] font-semibold text-neutral-950 dark:text-white select-none">
              +{overflow}
            </span>
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
