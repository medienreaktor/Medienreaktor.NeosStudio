import { Button } from '@/components/ui/button'
import { useModals } from './ModalHost'

/**
 * The launcher for modal screens: a Settings button that opens the shared
 * settings modal.
 */
export function ModalLauncher() {
  const { openSettings } = useModals()

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label="Settings"
        onClick={() => openSettings()}
      >
        <i className="fas fa-gear" aria-hidden />
      </Button>
    </div>
  )
}
