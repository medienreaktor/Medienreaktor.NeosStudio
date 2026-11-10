import { createContext, useContext } from 'react'

/**
 * Whether the panel a component is rendered in is actually on screen.
 *
 * The panel system keeps every panel mounted - inactive tabs, collapsed
 * groups, floating groups hidden behind another main tab and the panels of a
 * collapsed (off-canvas) sidebar are only hidden via CSS, so their state
 * (tree expansion, scroll, a graph's zoom) survives. Their queries survive
 * too, and with them their observers: a mounted useQuery counts as "active"
 * for TanStack Query whether or not anyone can see it, so every invalidation
 * of its key refetches it - a hidden Trash or History panel re-read its
 * workspace's changes and events on every property save.
 *
 * GroupBody provides this per panel: true only while the panel is the active
 * tab of its group AND the group is expanded AND (floating) its window is
 * shown AND (docked) its region is on screen. Panels feed it to the
 * `subscribed` option of their queries: an unsubscribed observer is no
 * observer at all for the cache, so invalidations merely mark the query
 * stale (no fetch, no poll), and the moment the panel shows again the
 * observer re-subscribes and refetches what went stale meanwhile - the same
 * refetch-on-mount a freshly opened panel gets.
 *
 * Outside any panel (dialogs rendered elsewhere, the app shell, tests) the
 * default is true, so code shared between panels and other places is
 * unaffected.
 */
export const PanelVisibleContext = createContext(true)

/** Whether the enclosing panel is visible; true outside any panel. */
export function usePanelVisible(): boolean {
  return useContext(PanelVisibleContext)
}
