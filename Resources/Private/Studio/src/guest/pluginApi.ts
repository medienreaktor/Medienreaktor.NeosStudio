/**
 * The plugin API inside the preview frame: the rich text part of
 * `window.NeosStudio`, published by the guest for plugin code that extends
 * inline editing.
 *
 * Inline editing runs its own TipTap in the preview's window, built into this
 * bundle - not the shell's. An extension built in the shell (with the shell's
 * TipTap classes, plain objects of the shell's window) cannot be handed to an
 * editor here: TipTap's option merging and ProseMirror's identity checks
 * assume one copy in one window, and fail silently across two. So plugin code
 * for inline editing runs here, in this window: the PreviewController loads
 * each plugin's `guestJavascript` bundle right after this script, and it
 * registers into the registry below with the `tiptap` building blocks below -
 * the same names, imported from '@medienreaktor/neos-studio' the same way, as
 * in the shell. A plugin can thus share one rich text module between its
 * shell bundle (inspector) and its guest bundle (preview).
 *
 * Nothing else of the plugin API exists here: the preview frame has no
 * React, no app state and no Studio UI.
 */
import { version } from '../plugin-api/version'
import { richTextExtensionRegistry } from './richTextExtensions'
import { tiptap } from './tiptap'

export interface NeosStudioGuestPluginApi {
  version: typeof version
  richTextExtensions: typeof richTextExtensionRegistry
  tiptap: typeof tiptap
}

/**
 * Publish the API on the preview's window. Runs when the guest script is
 * evaluated - before the plugin guest bundles that follow it (deferred module
 * scripts) and before the editors mount on DOMContentLoaded, so their
 * registrations are in place for the first editors already.
 */
export function installGuestPluginApi(): void {
  const api: NeosStudioGuestPluginApi = {
    version,
    richTextExtensions: richTextExtensionRegistry,
    tiptap,
  }
  ;(window as { NeosStudio?: unknown }).NeosStudio = api
}
