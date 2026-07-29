import type { PanelId } from './panelLayout'

/**
 * Programmatic panel navigation: anything in the app (a notification row, a
 * shortcut, ...) can ask for a panel to be brought on screen; the PanelSystem
 * - the layout's single owner - subscribes and applies revealPanel(). A tiny
 * request bus instead of context because callers live outside the panel tree.
 */

type Listener = (panel: PanelId) => void

const listeners = new Set<Listener>()

export function requestPanelReveal(panel: PanelId): void {
  listeners.forEach((listener) => listener(panel))
}

export function onPanelRevealRequest(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
