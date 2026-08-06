import * as React from 'react'
import {
  keyboardShortcutRegistry,
  type KeyboardShortcutDefinition,
} from './registry'

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
  const latest = React.useRef(definition)
  latest.current = definition
  // Re-register only when identity or key binding changes; everything else
  // (handler, guard, labels) is read through the ref at dispatch time.
  const comboKey = JSON.stringify([definition.key, definition.combo])
  React.useEffect(() => {
    const { id } = latest.current
    keyboardShortcutRegistry.register({
      ...latest.current,
      handler: (event) => latest.current.handler(event),
      when: () => latest.current.when?.() ?? true,
    })
    return () => keyboardShortcutRegistry.unregister(id)
  }, [definition.id, comboKey])
}
