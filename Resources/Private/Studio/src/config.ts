export interface StudioConfig {
  clientId: string
  authorizeEndpoint: string
  tokenEndpoint: string
  apiBase: string
  redirectUri: string
  scopes: string
  /** Mirrors Neos.Neos.userInterface.navigateComponent.nodeTree */
  nodeTree: { loadingDepth: number }
  /** Mirrors ...navigateComponent.structureTree; loadingDepth 0 = unlimited */
  structureTree: { loadingDepth: number }
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
  redirectUri: window.location.origin + '/neos/studio',
  scopes: 'neos.read neos.write neos.publish',
  nodeTree: { loadingDepth: 4 },
  structureTree: { loadingDepth: 4 },
}

// Merge so a shell built before a config field existed still works.
export const config: StudioConfig = { ...fallback, ...window.__NEOS_STUDIO__ }
