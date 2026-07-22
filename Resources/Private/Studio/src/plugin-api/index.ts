/**
 * The Studio plugin API - the one public surface third-party packages build
 * against. Everything here is deliberate: a plugin sees these registries,
 * hooks and types and nothing else of the shell's internals.
 *
 * How a plugin reaches this at runtime
 * ------------------------------------
 * The shell is one bundle; its registries are module-level singletons living
 * inside it. A plugin ships its own separately-built bundle, so it cannot
 * `import` these directly - it would get a second, empty copy of every
 * singleton (and a second React, whose hooks/context would not line up with
 * the shell's). Instead the shell publishes this surface, plus its own React,
 * on `window` (see `installPluginApiGlobals`), and a plugin is built with
 * `react`, `react-dom`, `react/jsx-runtime` and `@medienreaktor/neos-studio`
 * marked as externals that resolve to those globals. The result: the plugin
 * renders with the shell's React and registers into the shell's registries -
 * the same instances the running app reads.
 *
 * Load order is handled for us. The shell's entry module sets these globals
 * and mounts before any plugin script runs (plugin scripts are injected as
 * deferred `type="module"` tags after the shell's), and the registries are
 * observable, so a plugin that registers after mount simply triggers a
 * re-render. Registration is idempotent (register-replaces-by-id), so HMR and
 * plugin reloads are safe.
 */

import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactJSXRuntime from 'react/jsx-runtime'

import { useStudio } from '@/app/StudioContext'
import { toast as toastImpl } from '@/components/ui/toast'
import { PanelRegistry, panelRegistry } from '@/features/panels/registry'
import {
  PropertyEditorRegistry,
  propertyEditorRegistry,
} from '@/features/inspector/editors/registry'
import {
  InspectorViewRegistry,
  inspectorViewRegistry,
} from '@/features/inspector/views/registry'
import {
  ValidatorRegistry,
  validatorRegistry,
} from '@/features/inspector/validators/registry'
import {
  LinkEditorRegistry,
  linkEditorRegistry,
} from '@/features/links/registry'
import {
  ModalRegistry,
  settingsDialogRegistry,
  type SettingsDialogDefinition,
} from '@/features/modals/registry'
import {
  KeyboardShortcutRegistry,
  keyboardShortcutRegistry,
  isMacPlatform,
} from '@/features/shortcuts/registry'
import { useKeyboardShortcut } from '@/features/shortcuts/useKeyboardShortcut'

/**
 * The API version a plugin can read to feature-detect. Bump on a
 * breaking change to any exported type or registry contract; plugins that
 * care can compare against it before registering.
 */
export const version = 1 as const

// Each registry is re-exported under a friendly name, annotated with its named
// class so the generated declaration references the class rather than an
// anonymous type (whose private members TS refuses to emit).

/** Register/unregister panels. See {@link PanelDefinition}. */
export const panels: PanelRegistry = panelRegistry
/** Register/unregister inspector + creation-dialog property editors. See {@link PropertyEditorDefinition}. */
export const editors: PropertyEditorRegistry = propertyEditorRegistry
/** Register/unregister inspector views (read-only property visualisations). */
export const views: InspectorViewRegistry = inspectorViewRegistry
/** Register/unregister named property validators. */
export const validators: ValidatorRegistry = validatorRegistry
/** Register/unregister link-editor type tabs. */
export const links: LinkEditorRegistry = linkEditorRegistry
/** Register/unregister settings-dialog screens. */
export const modals: ModalRegistry<SettingsDialogDefinition> =
  settingsDialogRegistry
/**
 * Register/unregister keyboard shortcuts. See {@link KeyboardShortcutDefinition}.
 * Module-level `shortcuts.register(...)` suits always-available actions;
 * inside a component (e.g. a registered panel) prefer
 * {@link useKeyboardShortcut}, which unregisters on unmount and always calls
 * the latest render's handler. Registered shortcuts appear automatically in
 * the shortcut overview (Shift+?).
 */
export const shortcuts: KeyboardShortcutRegistry = keyboardShortcutRegistry

export { useStudio, useKeyboardShortcut }

/**
 * True on macOS/iOS - for platform-dependent combos. 'mod' already resolves
 * per platform; reach for this only when the two platforms need genuinely
 * different keys (e.g. a combo the Mac browser menu reserves).
 */
export { isMacPlatform }

/** Options accepted by the toast helpers. */
export interface ToastOptions {
  /** Bold heading; defaults to a per-kind label ("Success", "Error", …). */
  title?: React.ReactNode
  /** Auto-dismiss delay in ms. `0` keeps the toast until dismissed. */
  timeout?: number
  /** Stable id - re-raising with the same id updates the toast in place. */
  id?: string
}

/**
 * The app-wide toast API. Always prefer these over inline error/success
 * messages. This is the intentional public subset of the shell's toast helper.
 */
export interface ToastApi {
  success: (message: React.ReactNode, options?: ToastOptions) => string
  info: (message: React.ReactNode, options?: ToastOptions) => string
  loading: (message: React.ReactNode, options?: ToastOptions) => string
  /** Accepts an Error / unknown and unwraps it to a message. */
  error: (message: unknown, options?: ToastOptions) => string
  dismiss: (id?: string) => void
}

export const toast: ToastApi = toastImpl

// Re-export the types a plugin needs to write a panel or an editor. These are
// the contract; keep them stable.
export type {
  PanelDefinition,
  PanelPlacement,
} from '@/features/panels/registry'
export type { PanelRect } from '@/features/panels/geometry'
export type { DockRegion } from '@/features/panels/panelLayout'
export type {
  PropertyEditorComponent,
  PropertyEditorDefinition,
  PropertyEditorProps,
  PropertyEditorSubject,
} from '@/features/inspector/editors/registry'
export type { StudioContextValue } from '@/app/StudioContext'
export type {
  InspectorViewComponent,
  InspectorViewDefinition,
  InspectorViewProps,
} from '@/features/inspector/views/registry'
export type {
  ValidatorDefinition,
  ValidatorFunction,
} from '@/features/inspector/validators/registry'
export type {
  LinkTypeDefinition,
  LinkTypeTabProps,
} from '@/features/links/registry'
export type {
  ModalIcon,
  SettingsDialogDefinition,
} from '@/features/modals/registry'
export type { KeyboardShortcutDefinition } from '@/features/shortcuts/registry'

/** The shape published at `window.NeosStudio` for plugin bundles to consume. */
export interface NeosStudioPluginApi {
  version: typeof version
  panels: typeof panels
  editors: typeof editors
  views: typeof views
  validators: typeof validators
  links: typeof links
  modals: typeof modals
  shortcuts: typeof shortcuts
  isMacPlatform: typeof isMacPlatform
  useStudio: typeof useStudio
  useKeyboardShortcut: typeof useKeyboardShortcut
  toast: typeof toast
}

declare global {
  interface Window {
    React?: typeof React
    ReactDOM?: typeof ReactDOM
    ReactJSXRuntime?: typeof ReactJSXRuntime
    NeosStudio?: NeosStudioPluginApi
  }
}

/**
 * Publish React and the plugin API on `window` so externalised plugin bundles
 * resolve them at runtime. Called once by the shell's entry module, before it
 * mounts and before any plugin script executes. Idempotent.
 */
export function installPluginApiGlobals(): void {
  window.React = React
  window.ReactDOM = ReactDOM
  window.ReactJSXRuntime = ReactJSXRuntime
  window.NeosStudio = {
    version,
    panels,
    editors,
    views,
    validators,
    links,
    modals,
    shortcuts,
    isMacPlatform,
    useStudio,
    useKeyboardShortcut,
    toast,
  }
}
