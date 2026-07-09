export interface StudioConfig {
  clientId: string
  authorizeEndpoint: string
  tokenEndpoint: string
  apiBase: string
  redirectUri: string
  scopes: string
}

declare global {
  interface Window {
    __NEOS_STUDIO__?: StudioConfig
  }
}

export const config: StudioConfig = window.__NEOS_STUDIO__ ?? {
  clientId: 'neos-studio',
  authorizeEndpoint: '/oauth/authorize',
  tokenEndpoint: '/oauth/token',
  apiBase: '/api',
  redirectUri: window.location.origin + '/neos/studio',
  scopes: 'neos.read neos.write neos.publish',
}
