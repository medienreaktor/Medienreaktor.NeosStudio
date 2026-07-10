import { useEffect, useState } from 'react'
import { beginLogin, getTokens, handleRedirectCallback, logout } from '@/auth/oauth'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/me'
import type { NodeDto } from '@/api/nodes'
import { useSites } from '@/api/sites'
import { Chip } from '@/components/ui/Chip'
import { Console, type InspectRequest } from '@/features/console/Console'
import { SiteSwitcher } from '@/features/sites/SiteSwitcher'
import { ContentOutliner } from '@/features/tree/ContentOutliner'
import { DocumentTree } from '@/features/tree/DocumentTree'

type AuthState = 'checking' | 'authenticated' | 'anonymous'

// Guards against a redirect loop if the silent auto-login ever fails:
// set before redirecting, cleared once tokens arrive.
const AUTO_LOGIN_KEY = 'neos-studio.auto_login_attempted'

export function App() {
  const [auth, setAuth] = useState<AuthState>('checking')
  const [error, setError] = useState<string | null>(null)
  const [inspect, setInspect] = useState<InspectRequest | null>(null)
  const [selectedDocument, setSelectedDocument] = useState<NodeDto | null>(null)

  const { data: me, error: meError } = useMe(auth === 'authenticated')
  const { data: sitesResponse } = useSites(auth === 'authenticated')

  const sites = sitesResponse?.sites ?? []
  const [siteNodeName, setSiteNodeName] = useState<string | null>(null)
  const activeSite =
    sites.find((s) => s.nodeName === siteNodeName) ?? sites.find((s) => s.nodeAddress !== null) ?? null

  useEffect(() => {
    ;(async () => {
      let callbackFailed = false
      try {
        await handleRedirectCallback()
      } catch (e) {
        callbackFailed = true
        setError(e instanceof Error ? e.message : String(e))
      }
      if (getTokens()) {
        sessionStorage.removeItem(AUTO_LOGIN_KEY)
        setAuth('authenticated')
      } else if (!callbackFailed && !sessionStorage.getItem(AUTO_LOGIN_KEY)) {
        // The Studio client is first-party and the shell already required a
        // backend login, so the authorization redirect completes silently.
        sessionStorage.setItem(AUTO_LOGIN_KEY, '1')
        void beginLogin()
      } else {
        setAuth('anonymous')
      }
    })()
  }, [])

  useEffect(() => {
    if (meError instanceof ApiError && meError.status === 401) {
      logout()
      setAuth('anonymous')
    }
  }, [meError])

  if (auth === 'checking') {
    return <div className="center muted">Loading Neos Studio…</div>
  }

  if (auth === 'anonymous') {
    return (
      <div className="center">
        <div className="login-card">
          <h1>Neos Studio</h1>
          <p className="muted">API debugging console</p>
          {error && <p className="error">{error}</p>}
          <button className="primary" onClick={() => beginLogin()}>
            Connect to the API
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            Neos <strong>Studio</strong> <span className="tag">debug</span>
          </div>
          {sites.length > 0 && (
            <SiteSwitcher
              sites={sites}
              value={activeSite?.nodeName ?? null}
              onChange={(nodeName) => {
                setSiteNodeName(nodeName)
                setSelectedDocument(null)
              }}
            />
          )}
        </div>
        {me && (
          <div className="identity">
            <span title="Authenticated account">
              👤 {me.account} <span className="muted">on {me.contentRepository}</span>
            </span>
            <span className="scopes">
              {me.scopes.map((s) => (
                <Chip key={s}>{s}</Chip>
              ))}
            </span>
            <button
              className="ghost"
              onClick={() => {
                logout()
                setAuth('anonymous')
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </header>

      {error && <div className="error banner">{error}</div>}

      <Console
        me={me}
        inspect={inspect}
        sidebarExtra={
          <>
            {activeSite ? (
              <DocumentTree
                key={activeSite.nodeAddress}
                site={activeSite}
                onSelect={(node) => {
                  setSelectedDocument(node)
                  setInspect({ path: `/api/nodes/${node.address}` })
                }}
              />
            ) : (
              <div className="tree-panel">
                <h2>Document tree</h2>
                <div className="muted small">Loading sites…</div>
              </div>
            )}
            <ContentOutliner
              document={selectedDocument}
              onSelect={(node) => setInspect({ path: `/api/nodes/${node.address}` })}
            />
          </>
        }
      />
    </div>
  )
}
