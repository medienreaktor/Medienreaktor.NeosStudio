import { useEffect, useState, type ReactNode } from 'react'
import type { Me } from '@/api/me'
import { prettyJson } from '@/utils/json'
import { QUICK_REQUESTS } from './quickRequests'
import { useConsoleRequest } from './useConsoleRequest'

export interface InspectRequest {
  path: string
}

export function Console({
  me,
  sidebarExtra,
  inspect,
}: {
  me?: Me
  /** Rendered above the quick requests, e.g. the content tree. */
  sidebarExtra?: ReactNode
  /** When a new object arrives, its path is sent as a GET immediately. */
  inspect?: InspectRequest | null
}) {
  const [method, setMethod] = useState('GET')
  const [path, setPath] = useState('/api/me')
  const [body, setBody] = useState('')
  const request = useConsoleRequest()

  const send = (m = method, p = path, b = body) => {
    setMethod(m)
    setPath(p)
    setBody(b)
    request.mutate({ method: m, path: p, body: b || undefined })
  }

  useEffect(() => {
    if (inspect) send('GET', inspect.path, '')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per inspect object
  }, [inspect])

  const result = request.data

  return (
    <div className="layout">
      <aside className="sidebar">
        {sidebarExtra}
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
        {request.error && <div className="error banner">{String(request.error)}</div>}

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
          <button className="primary" disabled={request.isPending} onClick={() => send()}>
            {request.isPending ? '…' : 'Send'}
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
            <pre>{prettyJson(result.body)}</pre>
          </div>
        )}
      </main>
    </div>
  )
}
