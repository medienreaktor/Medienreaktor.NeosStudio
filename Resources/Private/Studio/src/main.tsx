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
// cover legacy names from old node type definitions. Brands are omitted -
// add '@fortawesome/fontawesome-free/css/brands.min.css' if a project needs
// brand icons on node types.
import '@fortawesome/fontawesome-free/css/fontawesome.min.css'
import '@fortawesome/fontawesome-free/css/solid.min.css'
import '@fortawesome/fontawesome-free/css/regular.min.css'
import '@fortawesome/fontawesome-free/css/v4-shims.min.css'
import '@fortawesome/fontawesome-free/css/v4-font-face.min.css'
import { registerBuiltinPanels } from './features/panels/builtin'

// Built-in panels register before mount, exactly like third-party panels
// would from a plugin entry point.
registerBuiltinPanels()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
)
