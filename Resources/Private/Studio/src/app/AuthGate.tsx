import { useEffect, useState, type ReactNode } from 'react'
import {
  beginLogin,
  getTokens,
  handleRedirectCallback,
  logout,
  onSessionEnded,
} from '@/auth/oauth'
import { ApiError } from '@/api/http/errors'
import { useMe } from '@/api/neos/endpoints/me'
import { loadTranslations, translate as t } from '@/lib/i18n'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { BootScreen } from '@/app/BootScreen'

type AuthState = 'checking' | 'authenticated' | 'anonymous'

// Guards against a redirect loop if the silent auto-login ever fails:
// set before redirecting, cleared once tokens arrive.
const AUTO_LOGIN_KEY = 'neos-studio.auto_login_attempted'

// sessionStorage is unavailable in some privacy modes. Without it the loop
// guard cannot be kept across the redirect, so an unreadable flag counts as
// "already attempted" - the manual login screen is the safe outcome.
function autoLoginAttempted(): boolean {
  try {
    return sessionStorage.getItem(AUTO_LOGIN_KEY) !== null
  } catch {
    return true
  }
}

function setAutoLoginAttempted(attempted: boolean): void {
  try {
    if (attempted) sessionStorage.setItem(AUTO_LOGIN_KEY, '1')
    else sessionStorage.removeItem(AUTO_LOGIN_KEY)
  } catch {
    /* see autoLoginAttempted() */
  }
}

// Set once the redirect is under way: the page is about to unload, and the
// further 401s and session-end reports of requests still in flight must not
// flip the shell to the manual login screen in the meantime.
let redirecting = false

/**
 * Authorize silently - once. The Studio client is first-party and the shell
 * already required a backend login, so the authorization redirect completes
 * without interaction. Returns false when it was tried already in this tab
 * and came back without tokens: the caller shows the manual login instead of
 * redirecting in a loop.
 */
function tryAutoLogin(): boolean {
  if (redirecting) return true
  if (autoLoginAttempted()) return false
  redirecting = true
  setAutoLoginAttempted(true)
  void beginLogin()
  return true
}

/**
 * The authentication state machine in front of the shell: checking (the OAuth
 * callback, if any, is exchanged) → authenticated (renders the children) or
 * anonymous (a manual "Connect" screen). Tokens live in memory only (see
 * auth/oauth.ts), so every document load authorizes again through the silent
 * redirect, and so does a session that ends while the shell runs - a refresh
 * the server refuses, or a token the API stops accepting.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>('checking')

  useEffect(() => {
    void (async () => {
      // Label translations must be in place before anything renders labels;
      // browser-cached for a week, so this rarely costs a request.
      await loadTranslations()
      let callbackFailed = false
      try {
        await handleRedirectCallback()
      } catch (e) {
        callbackFailed = true
        toast.error(e, { title: t('app.loginFailed', 'Login failed') })
      }
      if (getTokens()) {
        setAutoLoginAttempted(false)
        setAuth('authenticated')
      } else if (callbackFailed || !tryAutoLogin()) {
        setAuth('anonymous')
      }
    })()
  }, [])

  // The tokens could not be refreshed (the refresh token was spent, revoked
  // or expired): authorize again rather than dropping the user onto the
  // manual screen - the backend session usually still stands, so this is a
  // round trip they barely notice. Falls back to the screen if that already
  // failed once in this tab.
  useEffect(
    () =>
      onSessionEnded(() => {
        if (!tryAutoLogin()) setAuth('anonymous')
      }),
    [],
  )

  // The me-query doubles as the token check: a 401 that survived the request
  // layer's refresh-and-retry means the API does not accept this session.
  const { error: meError } = useMe(auth === 'authenticated')
  useEffect(() => {
    if (meError instanceof ApiError && meError.status === 401) {
      logout()
      // Follows the external effects above (dropped tokens, a redirect that
      // may or may not start) - nothing render could derive this from.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      if (!tryAutoLogin()) setAuth('anonymous')
    }
  }, [meError])

  if (auth === 'checking') {
    return <BootScreen />
  }

  if (auth === 'anonymous') {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="rounded-lg border bg-neutral-50 dark:bg-neutral-900 px-12 py-10 text-center">
          <h1 className="mb-1 text-2xl font-semibold">Neos Studio</h1>
          <p className="mb-6 text-neutral-600 dark:text-neutral-400">
            {t('app.tagline', 'Editing environment for Neos')}
          </p>
          <Button onClick={() => beginLogin()}>
            {t('app.connectToApi', 'Connect to the API')}
          </Button>
        </div>
      </div>
    )
  }

  return children
}
