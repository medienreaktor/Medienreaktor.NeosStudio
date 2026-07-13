import { useEffect, useRef, useState } from 'react'
import { beginLogin, getTokens, handleRedirectCallback, logout } from '@/auth/oauth'
import { ApiError } from '@/api/client'
import { type DimensionSpacePoint, dimensionSpacePointEquals, useDimensions } from '@/api/dimensions'
import { useMe } from '@/api/me'
import { queryKeys } from '@/api/keys'
import { fetchNode, type NodeDto, useNodeVariants } from '@/api/nodes'
import { addressInDimension } from '@/api/nodeAddress'
import { useSites } from '@/api/sites'
import { useWorkspaces } from '@/api/workspaces'
import { queryClient } from '@/app/queryClient'
import { loadTranslations } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { SidebarResizeHandle, useResizableSidebar } from '@/components/ui/sidebar-resize'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { StudioProvider, type StudioContextValue } from '@/app/StudioContext'
import { CreateVariantDialog } from '@/features/dimensions/CreateVariantDialog'
import { DimensionSwitcher } from '@/features/dimensions/DimensionSwitcher'
import { PanelDock, PanelsProvider } from '@/features/panels/PanelSystem'
import { PreviewPane, PreviewToolbar } from '@/features/preview/PreviewPane'
import { SiteSwitcher } from '@/features/sites/SiteSwitcher'
import type { NodeEdit } from '@/features/tree/ContentOutliner'
import { PublishButton } from '@/features/workspaces/PublishButton'
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
  // Also the node outlined in the preview and revealed in the outliner.
  const [inspectedNode, setInspectedNode] = useState<NodeDto | null>(null)
  // The last inline edit from the preview; refreshes the outliner label.
  const [lastEdit, setLastEdit] = useState<NodeEdit | null>(null)
  // Bumped after inspector edits so the preview shows them (inline edits
  // already render live inside the iframe and need no reload).
  const [previewReloadToken, setPreviewReloadToken] = useState(0)
  // Whether the preview renders with in-place editing; toggled in the topbar.
  const [previewEditing, setPreviewEditing] = useState(true)

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

  const { data: dimensionsResponse } = useDimensions(auth === 'authenticated')
  const dimensions = dimensionsResponse?.dimensions ?? []
  // null = let the backend pick its default dimension space point; the sites
  // response reports the point actually in effect, which the switcher shows.
  const [dimensionSpacePoint, setDimensionSpacePoint] = useState<DimensionSpacePoint | null>(null)
  // Set when the user picked a dimension the selected document does not exist
  // in - the create-variant dialog is open for this target point.
  const [variantRequest, setVariantRequest] = useState<DimensionSpacePoint | null>(null)
  // Where the selected document exists; drives the switcher's muted "+" items.
  const { data: documentVariants } = useNodeVariants(selectedDocument?.address ?? null, auth === 'authenticated')

  // Keep the user on the same document across a dimension switch: fetch the
  // node at its address in the target point and reselect it once it resolves.
  // The counter drops stale responses when dimensions change in quick
  // succession, so a slow earlier fetch cannot override the latest switch.
  const followDocumentRequest = useRef(0)
  const followDocumentInto = (previousAddress: string, point: DimensionSpacePoint) => {
    const request = ++followDocumentRequest.current
    fetchNode(addressInDimension(previousAddress, point))
      .then((node) => {
        if (followDocumentRequest.current !== request) return
        setSelectedDocument(node)
        setInspectedNode(node)
      })
      .catch(() => {
        /* fine - the tree simply starts unselected */
      })
  }

  const { data: sitesResponse } = useSites(activeWorkspace?.name ?? null, dimensionSpacePoint, auth === 'authenticated')

  const sites = sitesResponse?.sites ?? []
  const [siteNodeName, setSiteNodeName] = useState<string | null>(null)
  const activeSite =
    sites.find((s) => s.nodeName === siteNodeName) ?? sites.find((s) => s.nodeAddress !== null) ?? null

  useEffect(() => {
    ;(async () => {
      // Label translations must be in place before anything renders labels;
      // browser-cached for a week, so this rarely costs a request.
      await loadTranslations()
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

  // The app state and actions panels read via useStudio(). Panels register
  // themselves in the panel registry (see features/panels/builtin.tsx); their
  // placement (sidebar dock, floating, tab grouping) is the panel system's
  // business.
  const studio: StudioContextValue = {
    site: activeSite,
    workspaceName: activeWorkspace?.name ?? null,
    selectedDocument,
    inspectedNode,
    lastEdit,
    selectDocument: (node) => {
      setSelectedDocument(node)
      setInspectedNode(node)
    },
    inspectNode: setInspectedNode,
    nodeEdited: (address) => {
      setLastEdit((prev) => ({ address, token: (prev?.token ?? 0) + 1 }))
      setPreviewReloadToken((token) => token + 1)
      // The inspected-node snapshot is stale now - the save already
      // invalidated the cache, so this refetches fresh values.
      fetchNode(address)
        .then(setInspectedNode)
        .catch(() => {
          /* fine - keep showing the previous snapshot */
        })
    },
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
      <StudioProvider value={studio}>
        <PanelsProvider>
          <Sidebar>
            <SidebarHeader>
              <div className="px-2 py-1 text-lg">
                Neos <strong>Studio</strong>
              </div>
            </SidebarHeader>
            <SidebarContent className="overflow-hidden">
              <PanelDock />
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
                {dimensions.length > 0 && sitesResponse && (
                  <DimensionSwitcher
                    dimensions={dimensions}
                    allowedPoints={dimensionsResponse?.allowedDimensionSpacePoints ?? []}
                    value={dimensionSpacePoint ?? sitesResponse.dimensionSpacePoint}
                    documentCoverage={selectedDocument ? documentVariants?.coveredDimensionSpacePoints : undefined}
                    onCreateVariant={setVariantRequest}
                    onChange={(point) => {
                      const previousAddress = selectedDocument?.address ?? null
                      setDimensionSpacePoint(point)
                      setSelectedDocument(null)
                      setInspectedNode(null)
                      if (previousAddress) followDocumentInto(previousAddress, point)
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
              <div className="flex items-center gap-2">
                <PreviewToolbar
                  document={selectedDocument}
                  editing={previewEditing}
                  onToggleEditing={() => setPreviewEditing((value) => !value)}
                  onReload={() => setPreviewReloadToken((token) => token + 1)}
                />
                {activeWorkspace && <PublishButton workspaceName={activeWorkspace.name} />}
              </div>
            </header>
    
            {error && <div className="px-4 py-2.5 text-destructive">{error}</div>}
    
            <PreviewPane
              document={selectedDocument}
              editing={previewEditing}
              selectedAddress={inspectedNode?.address ?? null}
              onSelectNode={(address) => {
                // A click in the preview: inspect the node and reveal it in the
                // outliner (via selectedAddress above).
                fetchNode(address)
                  .then(setInspectedNode)
                  .catch(() => {
                    /* fine - e.g. the node vanished from this workspace meanwhile */
                  })
              }}
              onNavigateToNode={(address) => {
                // A followed link: show the target document; the document tree
                // reveals and selects it via selectedAddress. Links can cross
                // dimensions (e.g. a language menu) - follow the switch so the
                // trees browse the same dimension as the preview.
                fetchNode(address)
                  .then((node) => {
                    const currentPoint = dimensionSpacePoint ?? sitesResponse?.dimensionSpacePoint
                    if (currentPoint && !dimensionSpacePointEquals(node.dimensionSpacePoint, currentPoint)) {
                      setDimensionSpacePoint(node.dimensionSpacePoint)
                    }
                    setSelectedDocument(node)
                    setInspectedNode(node)
                  })
                  .catch(() => {
                    /* fine - e.g. the linked document is not visible in this workspace */
                  })
              }}
              onNodeEdited={(address) => setLastEdit((prev) => ({ address, token: (prev?.token ?? 0) + 1 }))}
              reloadToken={previewReloadToken}
            />
    
            {variantRequest && selectedDocument && activeWorkspace && (
              <CreateVariantDialog
                document={selectedDocument}
                targetPoint={variantRequest}
                dimensions={dimensions}
                workspaceName={activeWorkspace.name}
                onCancel={() => setVariantRequest(null)}
                onCreated={(point) => {
                  setVariantRequest(null)
                  const previousAddress = selectedDocument.address
                  // The new variants exist now - drop every cached node read and
                  // the pending-changes badge state before anything refetches.
                  void queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
                  void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
                  setDimensionSpacePoint(point)
                  setSelectedDocument(null)
                  setInspectedNode(null)
                  // Follow the document into its new dimension so outliner and
                  // inspector show the just-created variant right away.
                  followDocumentInto(previousAddress, point)
                }}
              />
            )}
          </SidebarInset>
        </PanelsProvider>
      </StudioProvider>
    </SidebarProvider>
  )
}
