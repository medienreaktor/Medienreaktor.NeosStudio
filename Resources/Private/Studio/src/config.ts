/** One classic backend module in the legacy-modules menu. */
export interface LegacyModule {
  /** Already translated server-side (into the interface language). */
  label: string
  /** FontAwesome classes, e.g. "fas fa-briefcase". */
  icon: string
  /** Absolute URI of the module inside the classic backend. */
  uri: string
  submodules: Array<Omit<LegacyModule, 'submodules'>>
}

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
  /**
   * Whether a successful "Publish all" celebrates with a confetti burst;
   * mirrors the Medienreaktor.NeosStudio.publishCelebration setting, which an
   * operator can turn off installation-wide.
   */
  publishCelebration: boolean
  /** Core endpoint serving the XLIFF labels as JSON (session-authenticated). */
  xliffEndpoint: string
  /** Classic backend logout (POST, session-authenticated). */
  logoutEndpoint: string
  /**
   * The optional realtime sidecar (a Hocuspocus WebSocket server, see "The
   * realtime sidecar" in the package README). url null = not configured:
   * collaboration falls back to plain HTTP polling, which needs no extra
   * infrastructure.
   */
  realtime: { url: string | null }
  /**
   * The classic backend modules shown in the menu next to the logo -
   * privilege-filtered and label-translated server-side. Empty hides the
   * menu; the enableLegacyModules setting (on by default) controls it.
   */
  legacyModules: LegacyModule[]
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
  publishCelebration: true,
  xliffEndpoint: '/neos/xliff.json',
  logoutEndpoint: '/neos/logout',
  realtime: { url: null },
  legacyModules: [],
}

// Merge so a shell built before a config field existed still works.
export const config: StudioConfig = { ...fallback, ...window.__NEOS_STUDIO__ }
