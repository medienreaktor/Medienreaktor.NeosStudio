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

import { ApiError } from '@/api/http/errors'
import { apiFetch } from '@/api/neos/client'
import { useStudio, useStudioActions } from '@/app/StudioContext'
import { toast as toastImpl } from '@/components/ui/toast'
import {
  presenceColor,
  presenceInitials,
} from '@/features/collaboration/presenceColors'
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
import {
  NodeDecoratorRegistry,
  nodeDecoratorRegistry,
} from '@/features/tree/decorators'
import {
  WorkspaceDecoratorRegistry,
  workspaceDecoratorRegistry,
} from '@/features/workspaces/decorators'

/**
 * The API version a plugin can read to feature-detect. Bump on a
 * breaking change to any exported type or registry contract; plugins that
 * care can compare against it before registering.
 */
export const version = 1 as const

// Each registry is re-exported under a friendly name, annotated with its named
// class so the public type reads as that class (what an editor's hover and a
// plugin author's own typings refer to) rather than an anonymous structural
// type. The declarations ship as one bundled file,
// Resources/Public/Studio/types/index.d.ts (`npm run build:plugin-types`,
// run at the end of `npm run build`): a plugin package maps
// '@medienreaktor/neos-studio' to that file in its tsconfig `paths` (e.g.
// "../../Packages/Plugins/Medienreaktor.NeosStudio/Resources/Public/Studio/types/index.d.ts")
// and resolves the import to the window global at runtime. The bundle keeps
// react/react-dom external, so the plugin needs @types/react installed.

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
/**
 * Register/unregister settings sections - the screens listed in the shared
 * Settings modal's subnavigation (users, sites, workspaces, ...). See
 * {@link SettingsDialogDefinition}.
 */
export const settingsSections: ModalRegistry<SettingsDialogDefinition> =
  settingsDialogRegistry
/**
 * @deprecated The registry only ever held settings sections - use
 * {@link settingsSections}. Kept as an alias of the very same registry for
 * plugins built against API version 1.
 */
export const modals: ModalRegistry<SettingsDialogDefinition> = settingsSections
/**
 * Register/unregister keyboard shortcuts. See {@link KeyboardShortcutDefinition}.
 * Module-level `shortcuts.register(...)` suits always-available actions;
 * inside a component (e.g. a registered panel) prefer
 * {@link useKeyboardShortcut}, which unregisters on unmount and always calls
 * the latest render's handler. Registered shortcuts appear automatically in
 * the shortcut overview (Shift+?).
 */
export const shortcuts: KeyboardShortcutRegistry = keyboardShortcutRegistry
/**
 * Register/unregister workspace decorators - visual marks (badges) on
 * workspaces in the switcher and administration, derived from the workspace's
 * `extensions` data. See {@link WorkspaceDecoratorDefinition}.
 */
export const workspaceDecorators: WorkspaceDecoratorRegistry =
  workspaceDecoratorRegistry
/**
 * Register/unregister node decorators - per-node visuals on every tree row
 * (document tree, content outliner, search results, pickers): replace the
 * type icon, layer a badge onto its corner, tint or dim the whole row. The
 * shell's own type icon and hidden/deleted marks run through this registry
 * too. See {@link NodeDecoratorDefinition}.
 */
export const nodeDecorators: NodeDecoratorRegistry = nodeDecoratorRegistry

/**
 * useStudio() reads the shell's state and actions and re-renders on every
 * state change; useStudioActions() returns only the (stable) actions and
 * never re-renders on its own - prefer it in components that only act.
 */
export { useStudio, useStudioActions, useKeyboardShortcut }

/**
 * Typed requests sharing the shell's OAuth session (bearer token,
 * single-flighted refresh). Resolve with the parsed JSON body on 2xx and
 * throw {@link ApiError} otherwise.
 *  - apiFetch: Neos.Api, paths relative to its base ('/me' -> '/api/me').
 *    The Studio's operations of the Neos API ('/notifications',
 *    '/cr/default/tasks') are reached the same way. A plugin package can add
 *    operations of its own (an Api Class in
 *    Neos.OpenApi.FlowAdapter.apis.neos.classes, scopes as ApiPrivilege
 *    targets) and reach them exactly like the built-in ones.
 *  - studioFetch: an alias of apiFetch, kept for plugins written when the
 *    Studio's operations had a client of their own.
 */
const studioFetch = apiFetch
export { apiFetch, studioFetch, ApiError }

/**
 * The shell's per-user avatar scheme (initials avatars colored by user id) -
 * use these so people look the same in a plugin as they do in presence
 * indicators and the user menu.
 */
export { presenceColor, presenceInitials }

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
export type {
  StudioActions,
  StudioContextValue,
  StudioState,
} from '@/app/StudioContext'
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
export type {
  KeyboardShortcutDefinition,
  ResolvedKeyboardShortcut,
} from '@/features/shortcuts/registry'
export type {
  WorkspaceDecoration,
  WorkspaceDecoratorDefinition,
} from '@/features/workspaces/decorators'
export type {
  NodeDecoration,
  NodeDecorationContext,
  NodeDecorationOverlay,
  NodeDecoratorDefinition,
} from '@/features/tree/decorators'
// Neos.Api's models, as the shell uses them (generated from its OpenAPI
// document), and the Studio's own.
export type * from '@/api/neos/schema'
export type { NodeTypeMap } from '@/api/neos/endpoints/nodeTypes'
export type { Task, TaskStatus } from '@/api/studio/schema'

/** The shape published at `window.NeosStudio` for plugin bundles to consume. */
export interface NeosStudioPluginApi {
  version: typeof version
  panels: typeof panels
  editors: typeof editors
  views: typeof views
  validators: typeof validators
  links: typeof links
  settingsSections: typeof settingsSections
  /** @deprecated Alias of settingsSections. */
  modals: typeof modals
  shortcuts: typeof shortcuts
  workspaceDecorators: typeof workspaceDecorators
  nodeDecorators: typeof nodeDecorators
  isMacPlatform: typeof isMacPlatform
  useStudio: typeof useStudio
  useStudioActions: typeof useStudioActions
  useKeyboardShortcut: typeof useKeyboardShortcut
  toast: typeof toast
  apiFetch: typeof apiFetch
  studioFetch: typeof studioFetch
  ApiError: typeof ApiError
  presenceColor: typeof presenceColor
  presenceInitials: typeof presenceInitials
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
    settingsSections,
    modals,
    shortcuts,
    workspaceDecorators,
    nodeDecorators,
    isMacPlatform,
    useStudio,
    useStudioActions,
    useKeyboardShortcut,
    toast,
    apiFetch,
    studioFetch,
    ApiError,
    presenceColor,
    presenceInitials,
  }
}
