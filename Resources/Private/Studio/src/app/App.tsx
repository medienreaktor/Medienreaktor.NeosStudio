import { useEffect, useState } from 'react'
import { beginLogin, getTokens, handleRedirectCallback, logout } from '@/auth/oauth'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/me'
import type { NodeDto } from '@/api/nodes'
import { useSites } from '@/api/sites'
import { useWorkspaces } from '@/api/workspaces'
import { Button } from '@/components/ui/button'
import { SidebarResizeHandle, useResizableSidebar } from '@/components/ui/sidebar-resize'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Inspector } from '@/features/inspector/Inspector'
import { SiteSwitcher } from '@/features/sites/SiteSwitcher'
import { ContentOutliner } from '@/features/tree/ContentOutliner'
import { DocumentTree } from '@/features/tree/DocumentTree'
import { WorkspaceSwitcher } from '@/features/workspaces/WorkspaceSwitcher'

type AuthState = 'checking' | 'authenticated' | 'anonymous'

// Guards against a redirect loop if the silent auto-login ever fails:
// set before redirecting, cleared once tokens arrive.
const AUTO_LOGIN_KEY = 'neos-studio.auto_login_attempted'

export function App() {
  const [auth, setAuth] = useState<AuthState>('checking')
  const [error, setError] = useState<string | null>(null)
  const [selectedDocument, setSelectedDocument] = useState<NodeDto | null>(null)
  // The node shown in the inspector drawer - a document or a content node.
  const [inspectedNode, setInspectedNode] = useState<NodeDto | null>(null)

  // The identity itself is not displayed, but the me-query doubles as the
  // token check: a 401 drives the logout below.
  const { error: meError } = useMe(auth === 'authenticated')
  const { sidebarWidth, isResizing, resizeHandleProps } = useResizableSidebar()
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
          <p className="mb-6 text-muted-foreground">Editing environment for Neos</p>
          {error && <p className="mb-4 text-destructive">{error}</p>}
          <Button onClick={() => beginLogin()}>Connect to the API</Button>
        </div>
      </div>
    )
  }

  return (
    <SidebarProvider
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
      className={
        isResizing
          ? 'select-none **:data-[slot=sidebar-container]:transition-none! **:data-[slot=sidebar-gap]:transition-none!'
          : undefined
      }
    >
      <Sidebar>
        <SidebarHeader>
          <div className="px-2 py-1 text-lg">
            Neos <strong>Studio</strong>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Document tree</SidebarGroupLabel>
            <SidebarGroupContent>
              {activeSite && activeWorkspace ? (
                <DocumentTree
                  key={activeSite.nodeAddress}
                  site={activeSite}
                  workspaceName={activeWorkspace.name}
                  onSelect={(node) => {
                    setSelectedDocument(node)
                    setInspectedNode(node)
                  }}
                />
              ) : (
                <div className="px-2 text-xs text-muted-foreground">Loading sites…</div>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Content outliner</SidebarGroupLabel>
            <SidebarGroupContent>
              <ContentOutliner
                document={selectedDocument}
                workspaceName={activeWorkspace?.name ?? null}
                onSelect={setInspectedNode}
              />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarResizeHandle {...resizeHandleProps} />
      </Sidebar>

      <SidebarInset>
        <header className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="flex items-center gap-3">
            <SidebarTrigger />
            {sites.length > 0 && (
              <SiteSwitcher
                sites={sites}
                value={activeSite?.nodeName ?? null}
                onChange={(nodeName) => {
                  setSiteNodeName(nodeName)
                  setSelectedDocument(null)
                  setInspectedNode(null)
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
                  setInspectedNode(null)
                }}
              />
            )}
          </div>
        </header>

        {error && <div className="px-4 py-2.5 text-destructive">{error}</div>}

        {/* The rendered-page preview iframe will live here. */}
        <main className="grid flex-1 place-items-center p-6">
          <p className="text-sm text-muted-foreground">Page preview coming soon.</p>
        </main>

        <Inspector node={inspectedNode} onClose={() => setInspectedNode(null)} />
      </SidebarInset>
    </SidebarProvider>
  )
}
