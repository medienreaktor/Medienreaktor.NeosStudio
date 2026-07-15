import { SettingsIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useModals } from './ModalHost'
import { useModalDialogs } from './registry'

/**
 * The launcher for modal screens: one button per registered single-module
 * dialog (Media, ...) plus a Settings button that opens the shared settings
 * modal. Data-driven off the registries, so a plugin that registers a module
 * or a settings section lights up here without touching this component.
 */
export function ModalLauncher() {
  const { openModal, openSettings } = useModals()
  const modules = useModalDialogs()

  return (
    <div className="flex items-center gap-1">
      {modules.map((module) => {
        const Icon = module.icon
        return (
          <Button
            key={module.id}
            variant="ghost"
            size="sm"
            onClick={() => openModal(module.id)}
          >
            {Icon && <Icon className="size-4" />}
            {module.title}
          </Button>
        )
      })}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Settings"
        onClick={() => openSettings()}
      >
        <SettingsIcon className="size-4" />
      </Button>
    </div>
  )
}
