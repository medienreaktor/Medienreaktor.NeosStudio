import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSidebar } from '@/components/ui/sidebar'
import { useModals } from '@/features/modals/ModalHost'
import { translate as t } from '@/lib/i18n'
import { formatCombo, keyboardShortcutRegistry } from './registry'
import { useKeyboardShortcut } from './useKeyboardShortcut'

/**
 * The shortcut system's mount point: installs the single window keydown
 * listener that feeds the registry, registers the shell-level shortcuts that
 * have no better home (toggle sidebar, open settings, this overview), and
 * hosts the overview dialog listing every registered shortcut. Action-bound
 * shortcuts (publish, reload preview, ...) register in the components that
 * own the action instead, via useKeyboardShortcut.
 */
export function ShortcutHost() {
  const { toggleSidebar } = useSidebar()
  const { openSettings } = useModals()
  const [overviewOpen, setOverviewOpen] = React.useState(false)

  React.useEffect(() => {
    // Capture phase, so shortcuts still work while focus sits inside widgets
    // that stop keydown propagation. The editable-target guard in dispatch
    // keeps typing safe regardless.
    const onKeyDown = (event: KeyboardEvent) =>
      keyboardShortcutRegistry.dispatch(event)
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const generalCategory = t('shortcuts.category.general', 'General')
  useKeyboardShortcut({
    id: 'sidebar.toggle',
    key: 'b',
    title: t('common.toggleSidebar', 'Toggle Sidebar'),
    category: generalCategory,
    handler: toggleSidebar,
  })
  useKeyboardShortcut({
    id: 'settings.open',
    // 'o' as in options - the platform's ⌘+, convention is a symbol key
    // (layout-dependent) and menu-bound in every macOS browser.
    key: 'o',
    title: t('shortcuts.openSettings', 'Open settings'),
    category: generalCategory,
    handler: () => openSettings(),
  })
  useKeyboardShortcut({
    id: 'shortcuts.overview',
    // The sanctioned exception to the unified accessor: '?' is the
    // universal shortcut-help key (Gmail, GitHub, Slack). Raw combo, so it
    // stays input-guarded - '?' is typing.
    combo: 'shift+?',
    title: t('shortcuts.showOverview', 'Show keyboard shortcuts'),
    category: generalCategory,
    handler: () => setOverviewOpen((open) => !open),
  })

  return (
    <ShortcutOverviewDialog
      open={overviewOpen}
      onOpenChange={setOverviewOpen}
    />
  )
}

function useRegisteredShortcuts() {
  return React.useSyncExternalStore(
    (onChange) => keyboardShortcutRegistry.subscribe(onChange),
    () => keyboardShortcutRegistry.getAll(),
  )
}

/** All registered shortcuts, grouped by category in first-seen order. */
function ShortcutOverviewDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const shortcuts = useRegisteredShortcuts()
  const groups = new Map<string, typeof shortcuts>()
  const fallbackCategory = t('shortcuts.category.other', 'Other')
  for (const shortcut of shortcuts) {
    const category = shortcut.category ?? fallbackCategory
    const list = groups.get(category)
    if (list) list.push(shortcut)
    else groups.set(category, [shortcut])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[80svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('shortcuts.overview.title', 'Keyboard shortcuts')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'shortcuts.overview.description',
              'Shortcuts available in Neos Studio, including those added by plugins.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          {[...groups.entries()].map(([category, entries]) => (
            <section key={category}>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
                {category}
              </h3>
              <ul className="divide-y divide-neutral-800">
                {entries.map((shortcut) => (
                  <li
                    key={shortcut.id}
                    className="flex items-center justify-between gap-4 py-1.5 text-sm"
                  >
                    <span>{shortcut.title}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {(Array.isArray(shortcut.combo)
                        ? shortcut.combo
                        : [shortcut.combo]
                      ).map((combo) => (
                        <ShortcutKeys key={combo} combo={combo} />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ShortcutKeys({ combo }: { combo: string }) {
  return (
    <kbd className="flex items-center gap-0.5">
      {formatCombo(combo).map((part, index) => (
        <span
          key={index}
          className="min-w-6 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-center font-sans text-xs text-neutral-300"
        >
          {part}
        </span>
      ))}
    </kbd>
  )
}
