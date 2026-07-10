import { useEffect, useState, type ReactNode } from 'react'
import type { Me } from '@/api/me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { prettyJson } from '@/utils/json'
import { QUICK_REQUESTS } from './quickRequests'
import { useConsoleRequest } from './useConsoleRequest'

export interface InspectRequest {
  path: string
}

const METHODS = ['GET', 'POST', 'PUT', 'DELETE']

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
    <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr]">
      <aside className="overflow-y-auto border-r bg-card p-4">
        {sidebarExtra}
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quick requests</h2>
        {QUICK_REQUESTS.map((q) => (
          <button
            key={q.label}
            className="mb-1.5 flex w-full items-center gap-2 rounded-md border bg-secondary px-3 py-2 text-left text-sm hover:brightness-115"
            onClick={() => send(q.method, q.path, q.body ?? '')}
          >
            <span
              className={cn(
                'rounded-sm px-1.5 py-0.5 text-[0.65rem] font-bold',
                q.method === 'GET' ? 'bg-success/15 text-success' : 'bg-warn/15 text-warn',
              )}
            >
              {q.method}
            </span>
            {q.label.replace(/^\w+\s/, '')}
          </button>
        ))}
        {me && (
          <div className="mt-6">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Roles</h3>
            {me.roles.map((r) => (
              <div key={r} className="text-xs text-muted-foreground">
                {r}
              </div>
            ))}
          </div>
        )}
      </aside>

      <main className="min-h-0 overflow-y-auto p-5">
        {request.error && <div className="mb-4 text-destructive">{String(request.error)}</div>}

        <div className="flex gap-2">
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="flex-1 font-mono"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/api/nodes/{address}/children"
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <Button disabled={request.isPending} onClick={() => send()}>
            {request.isPending ? '…' : 'Send'}
          </Button>
        </div>

        {method !== 'GET' && (
          <Textarea
            className="mt-3 font-mono text-sm"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="JSON request body"
            rows={8}
          />
        )}

        {result && (
          <div className="mt-5">
            <div className={cn('mb-2 font-semibold', result.ok ? 'text-success' : 'text-destructive')}>
              {result.status} {result.ok ? 'OK' : 'Error'} · {result.durationMs} ms
            </div>
            <pre className="overflow-x-auto rounded-md border bg-card p-4 font-mono text-sm leading-relaxed">
              {prettyJson(result.body)}
            </pre>
          </div>
        )}
      </main>
    </div>
  )
}
