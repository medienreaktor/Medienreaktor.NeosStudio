import React from 'react'
import ReactDOM from 'react-dom/client'
import { AppProviders } from './app/providers'
import { App } from './app/App'
import './styles.css'
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
)
