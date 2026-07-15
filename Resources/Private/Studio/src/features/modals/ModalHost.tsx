import * as React from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  modalDialogRegistry,
  type SettingsDialogDefinition,
  useSettingsDialogs,
} from './registry'

/**
 * The modal host: one place that owns "which modal is open" and renders it
 * near-screen-filling above the app. Two kinds live here (see registry.ts):
 *
 *  - a single-module dialog (Media, ...) resolved from modalDialogRegistry, and
 *  - the shared Settings modal, whose subnavigation lists every section
 *    registered in settingsDialogRegistry and whose body shows the active one.
 *
 * Components anywhere below <ModalProvider> open and close modals through
 * useModals(); the host is rendered once by the provider. Only one modal is
 * ever open - opening another replaces it - so the whole thing is a single
 * base-ui Dialog whose content switches on the open kind, giving us focus
 * trapping, Escape-to-close and backdrop-click for free.
 */

type OpenState =
  | { kind: 'none' }
  | { kind: 'module'; id: string }
  | { kind: 'settings'; sectionId: string | null }

interface ModalContextValue {
  /** Open a single-module dialog by its registered id. */
  openModal: (id: string) => void
  /** Open the Settings modal, optionally on a specific section. */
  openSettings: (sectionId?: string) => void
  /** Close whatever modal is open. */
  close: () => void
  /** The single-module dialog currently open, or null. */
  activeModalId: string | null
  /** Whether the Settings modal is open. */
  settingsOpen: boolean
}

const ModalContext = React.createContext<ModalContextValue | null>(null)

export function useModals(): ModalContextValue {
  const context = React.useContext(ModalContext)
  if (!context) throw new Error('useModals() requires a <ModalProvider> above')
  return context
}

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState<OpenState>({ kind: 'none' })

  const context = React.useMemo<ModalContextValue>(
    () => ({
      openModal: (id) => setOpen({ kind: 'module', id }),
      openSettings: (sectionId) =>
        setOpen({ kind: 'settings', sectionId: sectionId ?? null }),
      close: () => setOpen({ kind: 'none' }),
      activeModalId: open.kind === 'module' ? open.id : null,
      settingsOpen: open.kind === 'settings',
    }),
    [open],
  )

  return (
    <ModalContext.Provider value={context}>
      {children}
      <ModalHost open={open} onOpenChange={setOpen} />
    </ModalContext.Provider>
  )
}

function ModalHost({
  open,
  onOpenChange,
}: {
  open: OpenState
  onOpenChange: (state: OpenState) => void
}) {
  return (
    <DialogPrimitive.Root
      open={open.kind !== 'none'}
      onOpenChange={(next) => {
        // base-ui reports the requested open state; false means Escape or a
        // backdrop click, so collapse back to nothing open.
        if (!next) onOpenChange({ kind: 'none' })
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          data-slot="modal-overlay"
          className="fixed inset-0 z-200 bg-neutral-950/80 backdrop-blur-sm transition-opacity duration-200 data-starting-style:opacity-0 data-ending-style:opacity-0"
        />
        <DialogPrimitive.Popup
          data-slot="modal-content"
          className="fixed inset-4 z-200 flex flex-col overflow-hidden rounded-lg border bg-neutral-950 text-white shadow-lg transition-[opacity,transform] duration-200 data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-ending-style:scale-[0.98] data-ending-style:opacity-0 md:inset-8"
        >
          {open.kind === 'module' && <ModuleModal id={open.id} />}
          {open.kind === 'settings' && (
            <SettingsModal
              sectionId={open.sectionId}
              onSelect={(sectionId) =>
                onOpenChange({ kind: 'settings', sectionId })
              }
            />
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** Header row shared by both modal kinds: title, optional extras, close button. */
function ModalHeader({
  title,
  children,
}: {
  title: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
      <DialogPrimitive.Title className="text-lg font-semibold text-white">
        {title}
      </DialogPrimitive.Title>
      <div className="ml-auto flex items-center gap-2">
        {children}
        <DialogPrimitive.Close
          className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-hidden"
          aria-label="Close"
        >
          <XIcon className="size-4" />
        </DialogPrimitive.Close>
      </div>
    </header>
  )
}

/** A single-module dialog: full modal filled by one registered module. */
function ModuleModal({ id }: { id: string }) {
  const definition = modalDialogRegistry.get(id)
  if (!definition) {
    // The module unregistered while open (a plugin reload); show nothing
    // rather than crash - the user can close the empty modal.
    return <ModalHeader title="Unavailable" />
  }
  const Body = definition.component
  return (
    <>
      <ModalHeader title={definition.title} />
      <div className="min-h-0 flex-1 overflow-auto">
        <Body />
      </div>
    </>
  )
}

/** The shared Settings modal: subnavigation of sections plus the active one. */
function SettingsModal({
  sectionId,
  onSelect,
}: {
  sectionId: string | null
  onSelect: (sectionId: string) => void
}) {
  const sections = useSettingsDialogs()
  // Default to the first section when none was requested, or when the
  // requested one is not (or no longer) registered. A disabled section can
  // still be the active one (it is shown selected); its body handles the
  // no-access case itself.
  const active =
    sections.find((section) => section.id === sectionId) ?? sections[0] ?? null

  return (
    <>
      <ModalHeader title="Settings" />
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Settings sections"
          className="w-56 shrink-0 overflow-y-auto border-r p-2"
        >
          {sections.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-neutral-400">
              No settings available
            </p>
          )}
          {sections.map((section) => (
            <SettingsNavItem
              key={section.id}
              section={section}
              isActive={section.id === active?.id}
              onSelect={onSelect}
            />
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-auto">
          {/* Keyed by section id so switching sections remounts the body -
              each section's optional useEnabled() hook then runs on a fresh
              component, keeping hook order stable across a section change. */}
          {active && <SettingsSectionBody key={active.id} section={active} />}
        </div>
      </div>
    </>
  )
}

/**
 * One entry in the settings subnavigation. A dedicated component so the
 * section's optional useEnabled() hook (and whatever hooks it calls) runs in a
 * stable position - one instance per section id.
 */
function SettingsNavItem({
  section,
  isActive,
  onSelect,
}: {
  section: SettingsDialogDefinition
  isActive: boolean
  onSelect: (sectionId: string) => void
}) {
  const enabled = section.useEnabled ? section.useEnabled() : true
  const Icon = section.icon
  return (
    <button
      type="button"
      disabled={!enabled}
      title={!enabled ? section.disabledReason : undefined}
      onClick={() => onSelect(section.id)}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
        !enabled
          ? 'cursor-not-allowed text-neutral-600'
          : isActive
            ? 'bg-neutral-800 text-white'
            : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-white',
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      {section.title}
    </button>
  )
}

/**
 * The body of the active settings section. When the section is disabled (no
 * access) it shows a neutral placeholder rather than the section component,
 * so a defaulted-to disabled section never renders its content or fires its
 * requests.
 */
function SettingsSectionBody({
  section,
}: {
  section: SettingsDialogDefinition
}) {
  const enabled = section.useEnabled ? section.useEnabled() : true
  if (!enabled) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-sm text-neutral-400">
        {section.disabledReason ?? 'You do not have access to this section.'}
      </div>
    )
  }
  const Body = section.component
  return <Body />
}
