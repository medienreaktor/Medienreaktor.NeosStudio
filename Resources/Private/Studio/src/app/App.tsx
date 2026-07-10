import { useEffect, useState } from 'react'
import { beginLogin, getTokens, handleRedirectCallback, logout } from '@/auth/oauth'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/me'
import type { NodeDto } from '@/api/nodes'
import { useSites } from '@/api/sites'
import { useWorkspaces } from '@/api/workspaces'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Console, type InspectRequest } from '@/features/console/Console'
import { SiteSwitcher } from '@/features/sites/SiteSwitcher'
import { WorkspaceSwitcher } from '@/features/workspaces/WorkspaceSwitcher'
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
  const { data: workspacesResponse } = useWorkspaces(auth === 'authenticated')

  // Editors never browse live (ROOT) directly - only their personal
  // workspace or shared ones. Default to the personal workspace.
  const workspaces = (workspacesResponse?.workspaces ?? []).filter(
    (w) => w.classification === 'PERSONAL' || w.classification === 'SHARED',
  )
  const [workspaceName, setWorkspaceName] = useState<string | null>(null)
  const activeWorkspace =
    workspaces.find((w) => w.name === workspaceName) ??
    workspaces.find((w) => w.classification === 'PERSONAL') ??
    workspaces[0] ??
    null

  const { data: sitesResponse } = useSites(activeWorkspace?.name ?? null, auth === 'authenticated')

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
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading Neos Studio…</div>
  }

  if (auth === 'anonymous') {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="rounded-lg border bg-card px-12 py-10 text-center">
          <h1 className="mb-1 text-2xl font-semibold">Neos Studio</h1>
          <p className="mb-6 text-muted-foreground">API debugging console</p>
          {error && <p className="mb-4 text-destructive">{error}</p>}
          <Button onClick={() => beginLogin()}>Connect to the API</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b bg-card px-5 py-3">
        <div className="flex items-center gap-4">
          <div className="text-lg">
            Neos <strong>Studio</strong>{' '}
            <span className="align-middle rounded-sm bg-primary px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-primary-foreground">
              debug
            </span>
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
          {workspaces.length > 0 && (
            <WorkspaceSwitcher
              workspaces={workspaces}
              value={activeWorkspace?.name ?? null}
              onChange={(name) => {
                setWorkspaceName(name)
                setSelectedDocument(null)
              }}
            />
          )}
        </div>
        {me && (
          <div className="flex items-center gap-4 text-sm">
            <span title="Authenticated account">
              👤 {me.account} <span className="text-muted-foreground">on {me.contentRepository}</span>
            </span>
            <span className="flex gap-1.5">
              {me.scopes.map((s) => (
                <Badge key={s} variant="secondary">
                  {s}
                </Badge>
              ))}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                logout()
                setAuth('anonymous')
              }}
            >
              Disconnect
            </Button>
          </div>
        )}
      </header>

      {error && <div className="px-5 py-2.5 text-destructive">{error}</div>}

      <Console
        me={me}
        inspect={inspect}
        sidebarExtra={
          <>
            {activeSite && activeWorkspace ? (
              <DocumentTree
                key={activeSite.nodeAddress}
                site={activeSite}
                workspaceName={activeWorkspace.name}
                onSelect={(node) => {
                  setSelectedDocument(node)
                  setInspect({ path: `/api/nodes/${node.address}` })
                }}
              />
            ) : (
              <div className="mb-6">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Document tree
                </h2>
                <div className="text-xs text-muted-foreground">Loading sites…</div>
              </div>
            )}
            <ContentOutliner
              document={selectedDocument}
              workspaceName={activeWorkspace?.name ?? null}
              onSelect={(node) => setInspect({ path: `/api/nodes/${node.address}` })}
            />
          </>
        }
      />
    </div>
  )
}
