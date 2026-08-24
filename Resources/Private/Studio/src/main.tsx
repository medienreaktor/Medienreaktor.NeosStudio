import React from 'react'
import ReactDOM from 'react-dom/client'
import { AppProviders } from './app/providers'
import { App } from './app/App'
import './styles.css'
// Noto Sans (SIL OFL) self-hosted so the shell matches the classic Neos UI
// typeface without a request to Google. Weights: 400 body, 500/600 for
// font-medium/font-semibold, 700 kept available for bold text. Only the
// latin + latin-ext subsets are shipped (enough for Western/Central European
// UI chrome); the aggregate imports would also pull cyrillic/greek/vietnamese/
// devanagari.
import '@fontsource/noto-sans/latin-400.css'
import '@fontsource/noto-sans/latin-500.css'
import '@fontsource/noto-sans/latin-600.css'
import '@fontsource/noto-sans/latin-700.css'
import '@fontsource/noto-sans/latin-ext-400.css'
import '@fontsource/noto-sans/latin-ext-500.css'
import '@fontsource/noto-sans/latin-ext-600.css'
import '@fontsource/noto-sans/latin-ext-700.css'
// Font Awesome free webfonts: node type icons are configured as FA names in
// Neos, so ship the fonts and render configured names verbatim. v4 shims
// cover legacy names from old node type definitions. Brands cover "fab"
// icons configured on node types.
import '@fortawesome/fontawesome-free/css/fontawesome.min.css'
import '@fortawesome/fontawesome-free/css/solid.min.css'
import '@fortawesome/fontawesome-free/css/regular.min.css'
import '@fortawesome/fontawesome-free/css/brands.min.css'
import '@fortawesome/fontawesome-free/css/v4-shims.min.css'
import '@fortawesome/fontawesome-free/css/v4-font-face.min.css'
import { registerBuiltinInspectorViews } from './features/inspector/views'
import { registerBuiltinLinkTypes } from './features/links/builtin'
import { registerBuiltinModals } from './features/modals/builtin'
import { registerBuiltinPanels } from './features/panels/builtin'
import { registerBuiltinTaskWorkflow } from './features/tasks/builtin'
import { registerBuiltinPropertyEditors } from './features/inspector/editors'
import { registerBuiltinValidators } from './features/inspector/validators'
import { registerBuiltinNodeDecorators } from './features/tree/builtinDecorators'
import { registerAccessNodeDecorator } from './features/access/accessDecorator'
import { installPluginApiGlobals } from './plugin-api'
import { initUiMode } from './lib/uiMode'

// Theme first: apply the user's UI mode preference (from the boot config)
// before anything renders, so a non-default mode never flashes dark.
initUiMode()

// Publish React and the plugin API on `window` before anything else, so the
// deferred plugin `type="module"` tags the StudioController injects after this
// script resolve their externals against the shell's own React and registry
// singletons. Must run before mount; the registries are observable, so a
// plugin registering after mount just triggers a re-render.
installPluginApiGlobals()

// Built-in panels, property editors, inspector views, validators, link types,
// modal screens and node decorators register before mount, exactly like
// third-party ones would from a plugin entry point.
registerBuiltinPanels()
registerBuiltinPropertyEditors()
registerBuiltinInspectorViews()
registerBuiltinValidators()
registerBuiltinLinkTypes()
registerBuiltinModals()
registerBuiltinNodeDecorators()
// After the built-in decorators so the lock badge layers on top of the type icon.
registerAccessNodeDecorator()
// After the other builtins so the Tasks tab lands after their main-region tabs.
registerBuiltinTaskWorkflow()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
)
