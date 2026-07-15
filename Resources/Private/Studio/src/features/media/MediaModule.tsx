import { MediaBrowser } from './MediaBrowser'

/**
 * The Media module, rendered as a single-module modal dialog (see
 * features/modals). This replaces the classic Neos Media backend module.
 *
 * It mounts the reusable MediaBrowser in "manage" mode; the same component is
 * reused in "picker" mode when selecting assets for node properties.
 */
export function MediaModule() {
  return <MediaBrowser mode="manage" />
}
