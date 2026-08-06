export interface StudioConfig {
  clientId: string
  authorizeEndpoint: string
  tokenEndpoint: string
  apiBase: string
  /** Endpoint of the Studio's own preview action (session-authenticated). */
  previewBase: string
  redirectUri: string
  scopes: string
  /** Mirrors Neos.Neos.userInterface.navigateComponent.nodeTree */
  nodeTree: { loadingDepth: number }
  /** Mirrors ...navigateComponent.structureTree; loadingDepth 0 = unlimited */
  structureTree: { loadingDepth: number }
  /** The backend user's interface language preference (e.g. "en", "de"). */
  interfaceLanguage: string
  /**
   * The backend user's UI mode preference; applied before mount so the shell
   * never flashes the wrong theme. Dark is the Studio default.
   */
  uiMode: 'light' | 'dark' | 'system'
  /** Core endpoint serving the XLIFF labels as JSON (session-authenticated). */
  xliffEndpoint: string
  /** Classic backend logout (POST, session-authenticated). */
  logoutEndpoint: string
}

declare global {
  interface Window {
    __NEOS_STUDIO__?: StudioConfig
  }
}

const fallback: StudioConfig = {
  clientId: 'neos-studio',
  authorizeEndpoint: '/oauth/authorize',
  tokenEndpoint: '/oauth/token',
  apiBase: '/api',
  previewBase: '/neos/studio/preview',
  redirectUri: window.location.origin + '/neos/studio',
  scopes: 'neos.read neos.write neos.publish neos.media',
  nodeTree: { loadingDepth: 4 },
  structureTree: { loadingDepth: 4 },
  interfaceLanguage: 'en',
  uiMode: 'dark',
  xliffEndpoint: '/neos/xliff.json',
  logoutEndpoint: '/neos/logout',
}

// Merge so a shell built before a config field existed still works.
export const config: StudioConfig = { ...fallback, ...window.__NEOS_STUDIO__ }
