import { useState } from 'react'
import type { Me } from '@/api/me'
import { prettyJson } from '@/utils/json'
import { QUICK_REQUESTS } from './quickRequests'
import { useConsoleRequest } from './useConsoleRequest'

export function Console({ me }: { me?: Me }) {
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

  const result = request.data

  return (
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
