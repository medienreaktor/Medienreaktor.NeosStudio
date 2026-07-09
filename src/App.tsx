import { useEffect, useMemo, useState } from 'react'
import { beginLogin, getTokens, handleRedirectCallback, logout } from './auth'
import { apiRequest, ApiResult } from './api'

type AuthState = 'checking' | 'authenticated' | 'anonymous'

interface Me {
  account: string | null
  roles: string[]
  scopes: string[]
  client: string | null
  contentRepository: string
}

const QUICK_REQUESTS: { label: string; method: string; path: string; body?: string }[] = [
  { label: 'GET /api/me', method: 'GET', path: '/api/me' },
  { label: 'GET /api/sites', method: 'GET', path: '/api/sites' },
  { label: 'GET /api/workspaces', method: 'GET', path: '/api/workspaces' },
  { label: 'GET /api/nodetypes', method: 'GET', path: '/api/nodetypes' },
  { label: 'GET /api/dimensions', method: 'GET', path: '/api/dimensions' },
  {
    label: 'POST /api/commands (SetNodeProperties)',
    method: 'POST',
    path: '/api/commands',
    body: JSON.stringify(
      {
        type: 'SetNodeProperties',
        payload: {
          workspaceName: 'live',
          nodeAggregateId: 'REPLACE_ME',
          originDimensionSpacePoint: { language: 'en_US' },
          propertyValues: { title: 'Changed via Studio' },
        },
      },
      null,
      2,
    ),
  },
]

export function App() {
  const [auth, setAuth] = useState<AuthState>('checking')
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [method, setMethod] = useState('GET')
  const [path, setPath] = useState('/api/me')
  const [body, setBody] = useState('')
  const [result, setResult] = useState<ApiResult | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        await handleRedirectCallback()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
      if (getTokens()) {
        setAuth('authenticated')
      } else {
        setAuth('anonymous')
      }
    })()
  }, [])

  useEffect(() => {
    if (auth !== 'authenticated') return
    apiRequest('GET', '/api/me').then((r) => {
      if (r.ok) setMe(r.body as Me)
      else if (r.status === 401) {
        logout()
        setAuth('anonymous')
      }
    })
  }, [auth])

  const send = async (m = method, p = path, b = body) => {
    setMethod(m)
    setPath(p)
    setBody(b)
    setLoading(true)
    setResult(null)
    try {
      setResult(await apiRequest(m, p, b || undefined))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const prettyBody = useMemo(() => {
    if (!result) return ''
    return typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2)
  }, [result])

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
        <div className="brand">
          Neos <strong>Studio</strong> <span className="tag">debug</span>
        </div>
        {me && (
          <div className="identity">
            <span title="Authenticated account">
              👤 {me.account} <span className="muted">on {me.contentRepository}</span>
            </span>
            <span className="scopes">
              {me.scopes.map((s) => (
                <span key={s} className="chip">
                  {s}
                </span>
              ))}
            </span>
            <button
              className="ghost"
              onClick={() => {
                logout()
                setAuth('anonymous')
                setMe(null)
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </header>

      {error && <div className="error banner">{error}</div>}

      <div className="layout">
        <aside className="sidebar">
          <h2>Quick requests</h2>
          {QUICK_REQUESTS.map((q) => (
            <button key={q.label} className="quick" onClick={() => send(q.method, q.path, q.body ?? '')}>
              <span className={`verb verb-${q.method.toLowerCase()}`}>{q.method}</span>
              {q.label.replace(/^\w+\s/, '')}
            </button>
          ))}
          {me && (
            <div className="roles">
              <h3>Roles</h3>
              {me.roles.map((r) => (
                <div key={r} className="muted small">
                  {r}
                </div>
              ))}
            </div>
          )}
        </aside>

        <main className="console">
          <div className="request-bar">
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              {['GET', 'POST', 'PUT', 'DELETE'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/api/nodes/{address}/children"
              onKeyDown={(e) => e.key === 'Enter' && send()}
            />
            <button className="primary" disabled={loading} onClick={() => send()}>
              {loading ? '…' : 'Send'}
            </button>
          </div>

          {method !== 'GET' && (
            <textarea
              className="body-input"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="JSON request body"
              rows={8}
            />
          )}

          {result && (
            <div className="response">
              <div className={`status ${result.ok ? 'ok' : 'fail'}`}>
                {result.status} {result.ok ? 'OK' : 'Error'} · {result.durationMs} ms
              </div>
              <pre>{prettyBody}</pre>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
