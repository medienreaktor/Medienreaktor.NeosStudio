import { config } from './config'

// Authorization-code + PKCE flow against Medienreaktor.NeosApi.
// The Studio client is first-party, so the consent screen is skipped and the
// only interactive step is the Neos backend login (which the shell already
// required to load).

const TOKEN_KEY = 'neos-studio.tokens'
const VERIFIER_KEY = 'neos-studio.pkce_verifier'
const STATE_KEY = 'neos-studio.oauth_state'

export interface Tokens {
  access_token: string
  refresh_token?: string
  expires_at: number
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
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64UrlEncode(digest)
}

export function getTokens(): Tokens | null {
  const raw = sessionStorage.getItem(TOKEN_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Tokens
  } catch {
    return null
  }
}

function storeTokens(data: { access_token: string; refresh_token?: string; expires_in: number }): void {
  const tokens: Tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tokens))
}

export function logout(): void {
  sessionStorage.removeItem(TOKEN_KEY)
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

/**
 * If the current URL is an OAuth callback (?code=&state=), exchange the code
 * for tokens and clean the URL. Returns true if a callback was handled.
 */
export async function handleRedirectCallback(): Promise<boolean> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    cleanUrl()
    throw new Error(`Authorization failed: ${error} ${url.searchParams.get('error_description') ?? ''}`)
  }
  if (!code) return false

  const expectedState = sessionStorage.getItem(STATE_KEY)
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  if (!verifier || state !== expectedState) {
    cleanUrl()
    throw new Error('OAuth state mismatch - possible CSRF, aborting.')
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    code,
    code_verifier: verifier,
  })
  const response = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    cleanUrl()
    throw new Error(`Token exchange failed (${response.status}): ${await response.text()}`)
  }
  storeTokens(await response.json())
  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)
  cleanUrl()
  return true
}

function cleanUrl(): void {
  window.history.replaceState({}, document.title, config.redirectUri)
}
