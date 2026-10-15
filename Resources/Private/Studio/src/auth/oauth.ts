import { config } from '@/config'

// Authorization-code + PKCE flow against Neos.OAuth.
// The Studio client is first-party, so the consent screen is skipped and the
// only interactive step is the Neos backend login (which the shell already
// required to load).

const VERIFIER_KEY = 'neos-studio.pkce_verifier'
const STATE_KEY = 'neos-studio.oauth_state'
/** Where earlier versions kept the tokens - removed on load, see below. */
const LEGACY_TOKEN_KEY = 'neos-studio.tokens'

export interface Tokens {
  access_token: string
  refresh_token?: string
  expires_at: number
}

/**
 * The tokens live in this module's closure only - never in sessionStorage or
 * any other storage.
 *
 * Why: the preview iframe renders the customer site same-origin, so every
 * script of that site (and of any other same-origin page) could read a token
 * kept in Web Storage and take it elsewhere - a bearer token works from
 * anywhere until it expires, and a refresh token keeps working beyond that.
 * In memory they are gone with the document, and a reload simply authorizes
 * again: the shell's silent auto-login (App's AUTO_LOGIN_KEY flow) redirects
 * through the authorization endpoint, which completes without interaction
 * because the backend session is still there; a deep link survives that
 * round trip in sessionStorage (app/deepLink.ts), as do the PKCE verifier and
 * state, which are worthless without the authorization code.
 *
 * The trust model that remains: a same-origin frame can still reach
 * `window.parent` - call the plugin API's apiFetch (window.NeosStudio), or
 * patch the shell's fetch to observe the Authorization header. Keeping tokens
 * out of storage stops passive theft and persistence, not a script that
 * actively drives the shell; the preview's site scripts are trusted as far as
 * the Neos backend session they run next to is. Isolating them for real would
 * take a sandboxed (opaque-origin) or cross-origin preview.
 */
let tokens: Tokens | null = null

try {
  sessionStorage.removeItem(LEGACY_TOKEN_KEY)
} catch {
  /* storage unavailable - nothing to clean up */
}

function base64UrlEncode(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function randomString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes.buffer)
}

async function sha256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  return base64UrlEncode(digest)
}

export function getTokens(): Tokens | null {
  return tokens
}

// The lifetime assumed for an access token whose response omits expires_in
// (RFC 6749 makes it only RECOMMENDED). Deliberately short: refreshing early
// costs one round-trip, assuming too long only defers the refresh to the
// first 401.
const DEFAULT_LIFETIME_S = 300

/**
 * A token endpoint response as far as the shell reads it; anything else
 * (an HTML error page, a proxy's JSON) is not one.
 */
interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

function isTokenResponse(data: unknown): data is TokenResponse {
  return (
    data !== null &&
    typeof data === 'object' &&
    typeof (data as { access_token?: unknown }).access_token === 'string'
  )
}

/** The parsed JSON body of a token endpoint response, null if it is none. */
async function tokenResponseOf(
  response: Response,
): Promise<TokenResponse | null> {
  try {
    const data: unknown = await response.json()
    return isTokenResponse(data) ? data : null
  } catch {
    return null
  }
}

function storeTokens(data: TokenResponse): Tokens {
  const lifetime =
    typeof data.expires_in === 'number' && Number.isFinite(data.expires_in)
      ? data.expires_in
      : DEFAULT_LIFETIME_S
  tokens = {
    access_token: data.access_token,
    // The refresh grant rotates refresh tokens (league revokes the old one and
    // returns a new one); fall back to the existing one only if a response ever
    // omits it, so we never lose the ability to refresh.
    refresh_token: data.refresh_token ?? tokens?.refresh_token,
    expires_at: Date.now() + lifetime * 1000,
  }
  return tokens
}

export function logout(): void {
  tokens = null
}

const sessionEndedListeners = new Set<() => void>()

/**
 * Subscribes to the end of the session: the tokens are gone because they can
 * no longer be refreshed (the refresh token was rejected - spent, revoked,
 * expired - or there never was one). Not called for transient failures
 * (network, 5xx, 429), which keep the tokens, nor for an explicit logout().
 *
 * The App reacts by authorizing again (beginLogin), which completes silently
 * while the backend session lasts. Returns the unsubscribe function.
 */
export function onSessionEnded(listener: () => void): () => void {
  sessionEndedListeners.add(listener)
  return () => {
    sessionEndedListeners.delete(listener)
  }
}

function endSession(): void {
  logout()
  sessionEndedListeners.forEach((listener) => listener())
}

/**
 * A user-initiated logout: drop the Studio tokens AND end the Neos backend
 * session - the shell route and the silent authorization redirect both ride
 * on it, so clearing only the tokens would log the user straight back in.
 * The reload afterwards runs into Flow security, which presents the backend
 * login form; logging in there boots a fresh Studio session.
 */
export async function logoutEverywhere(): Promise<void> {
  logout()
  try {
    // The core logout action skips CSRF protection, so a bare POST suffices.
    await fetch(config.logoutEndpoint, {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    /* session already gone or unreachable - the reload sorts it out */
  }
  window.location.assign(config.redirectUri)
}

// Treat a token as expired a little before its real deadline, so a request
// started just before expiry does not race the clock (and to absorb client/
// server clock skew).
const CLOCK_SKEW_MS = 30_000

// Coalesce concurrent refreshes: a burst of expired requests triggers exactly
// one token-endpoint round-trip, and they all await its result.
let refreshInFlight: Promise<Tokens | null> | null = null

function isExpired(stored: Tokens): boolean {
  return Date.now() >= stored.expires_at - CLOCK_SKEW_MS
}

/**
 * Exchange the stored refresh token for a fresh access token. Neos.OAuth
 * (league's RefreshTokenGrant) revokes the old access AND refresh token on
 * every refresh, so each call ends the previous pair - callers go through
 * {@link ensureRefreshed}, which single-flights it.
 *
 * A 400/401 (invalid_grant: the refresh token is spent, revoked or expired)
 * ends the session. Anything else - a network error, a 5xx, a 429 - is
 * transient: the stored tokens stay, and the next request tries again.
 */
async function refreshTokens(refreshToken: string): Promise<Tokens | null> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    refresh_token: refreshToken,
    // No scope param: inherit the originally granted scopes. Passing a scope
    // that is not a subset of them would fail the refresh.
  })
  let response: Response
  try {
    response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch {
    return null
  }
  if (response.status === 400 || response.status === 401) {
    endSession()
    return null
  }
  if (!response.ok) return null
  const data = await tokenResponseOf(response)
  return data ? storeTokens(data) : null
}

function ensureRefreshed(
  refreshToken: string | undefined,
): Promise<Tokens | null> {
  if (refreshInFlight) return refreshInFlight
  if (!refreshToken) {
    // Nothing to refresh with - the session cannot continue.
    endSession()
    return Promise.resolve(null)
  }
  refreshInFlight = refreshTokens(refreshToken).finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

/**
 * The access token to send with an API request, refreshed on demand when it
 * has expired. Returns null when there is no session or the refresh failed -
 * the caller then sends an unauthenticated request, which the API answers with
 * 401 and the shell turns into a re-login.
 */
export async function getValidAccessToken(): Promise<string | null> {
  if (refreshInFlight) return (await refreshInFlight)?.access_token ?? null
  if (!tokens) return null
  if (!isExpired(tokens)) return tokens.access_token
  return (await ensureRefreshed(tokens.refresh_token))?.access_token ?? null
}

/**
 * The access token to retry with after the server rejected `rejectedAccessToken`
 * (401) although the client believed it valid - revoked server-side (e.g.
 * after a dev database reset), or clock skew. Returns null when there is none.
 *
 * Only a rejection of the token currently stored refreshes: since every
 * refresh revokes the previous pair, rotating again for each late 401 of a
 * request that was sent with an older token would revoke the token just
 * issued, and the requests in between would cascade into 401s. Such a late
 * request gets the current token instead; a refresh already under way is
 * awaited.
 */
export async function forceRefreshAccessToken(
  rejectedAccessToken: string,
): Promise<string | null> {
  if (refreshInFlight) return (await refreshInFlight)?.access_token ?? null
  if (!tokens) return null
  if (tokens.access_token !== rejectedAccessToken) return tokens.access_token
  return (await ensureRefreshed(tokens.refresh_token))?.access_token ?? null
}

export async function beginLogin(): Promise<void> {
  const verifier = randomString(48)
  const state = randomString(12)
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(STATE_KEY, state)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes,
    state,
    code_challenge: await sha256Challenge(verifier),
    code_challenge_method: 'S256',
  })
  window.location.assign(`${config.authorizeEndpoint}?${params.toString()}`)
}

// The callback of this document load, handled once: React's StrictMode runs
// the boot effect twice, and exchanging the code twice would fail the second
// time (an authorization code is single-use) - or, worse, race the first.
let callbackHandling: Promise<boolean> | null = null

/**
 * If the current URL is an OAuth callback (?code=&state=), exchange the code
 * for tokens and clean the URL. Resolves true if a callback was handled.
 * Every call of a document load shares the first one's outcome.
 */
export function handleRedirectCallback(): Promise<boolean> {
  callbackHandling ??= exchangeCallbackCode()
  return callbackHandling
}

async function exchangeCallbackCode(): Promise<boolean> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    finishCallback()
    throw new Error(
      `Authorization failed: ${error} ${url.searchParams.get('error_description') ?? ''}`,
    )
  }
  if (!code) return false

  const expectedState = sessionStorage.getItem(STATE_KEY)
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  if (!verifier || state !== expectedState) {
    finishCallback()
    throw new Error('OAuth state mismatch - possible CSRF, aborting.')
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    code,
    code_verifier: verifier,
  })
  let response: Response
  try {
    response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch {
    finishCallback()
    throw new Error('Token exchange failed: the server is unreachable')
  }
  if (!response.ok) {
    finishCallback()
    throw new Error(
      `Token exchange failed (${response.status}): ${await response.text().catch(() => '')}`,
    )
  }
  const data = await tokenResponseOf(response)
  finishCallback()
  if (!data) throw new Error('Token exchange failed: no token in the response')
  storeTokens(data)
  return true
}

/**
 * Done with the callback, successfully or not: the verifier and state are
 * single-use, and the code must not stay in the URL (a reload would replay
 * it).
 */
function finishCallback(): void {
  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)
  cleanUrl()
}

function cleanUrl(): void {
  window.history.replaceState({}, document.title, config.redirectUri)
}
