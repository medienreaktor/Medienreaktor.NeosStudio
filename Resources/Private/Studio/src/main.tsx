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
import { registerBuiltinLinkTypes } from './features/links/builtin'
import { registerBuiltinModals } from './features/modals/builtin'
import { registerBuiltinPanels } from './features/panels/builtin'
import { registerBuiltinPropertyEditors } from './features/properties/editors'

// Built-in panels, property editors, link types and modal screens register
// before mount, exactly like third-party ones would from a plugin entry point.
registerBuiltinPanels()
registerBuiltinPropertyEditors()
registerBuiltinLinkTypes()
registerBuiltinModals()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
)
