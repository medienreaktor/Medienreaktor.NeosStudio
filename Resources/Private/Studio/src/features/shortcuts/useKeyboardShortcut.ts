import * as React from 'react'
import {
  keyboardShortcutRegistry,
  type KeyboardShortcutDefinition,
} from './registry'
import { useLatestRef } from '@/hooks/use-latest-ref'

/**
 * Register a keyboard shortcut for the lifetime of the calling component.
 * This is how components tie a shortcut to state they own (the publish
 * button's mutation, the sidebar's toggle): the registry entry stays stable
 * while handler and guard always see the latest render's closures, and
 * unmounting unregisters - a shortcut only exists while its action does.
 */
export function useKeyboardShortcut(
  definition: KeyboardShortcutDefinition,
): void {
  const latest = useLatestRef(definition)
  // Re-register when identity, key binding or the overview labels change;
  // handler and guard are read through the ref at dispatch time. The labels
  // are part of the registered entry the overview renders, so they must not
  // be snapshotted at mount - a translated title has to follow the language.
  const comboKey = JSON.stringify([
    definition.key,
    definition.combo,
    definition.title,
    definition.category,
  ])
  React.useEffect(() => {
    const { id } = latest.current
    keyboardShortcutRegistry.register({
      ...latest.current,
      handler: (event) => latest.current.handler(event),
      when: () => latest.current.when?.() ?? true,
    })
    return () => keyboardShortcutRegistry.unregister(id)
  }, [definition.id, comboKey, latest]) // latest: a stable ref
}
