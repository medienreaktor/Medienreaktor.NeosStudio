import { useEffect, useRef, useState } from 'react'
import {
  beginLogin,
  getTokens,
  handleRedirectCallback,
  logout,
} from '@/auth/oauth'
import { ApiError } from '@/api/client'
import {
  type DimensionSpacePoint,
  dimensionSpacePointEquals,
  useDimensions,
} from '@/api/dimensions'
import { useMe } from '@/api/me'
import { queryKeys } from '@/api/keys'
import { fetchNode, type NodeDto, useNodeVariants } from '@/api/nodes'
import { addressInDimension } from '@/api/nodeAddress'
import { useSites } from '@/api/sites'
import { useWorkspaces } from '@/api/workspaces'
import { queryClient } from '@/app/queryClient'
import { loadTranslations } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import {
  SidebarResizeHandle,
  useResizableSidebar,
} from '@/components/ui/sidebar-resize'
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
import { ModalLauncher } from '@/features/modals/ModalLauncher'
import { ModalProvider } from '@/features/modals/ModalHost'
import { PanelDock, PanelsProvider } from '@/features/panels/PanelSystem'
import { PreviewPane, PreviewToolbar } from '@/features/preview/PreviewPane'
import { SiteSwitcher } from '@/features/sites/SiteSwitcher'
import type { NodeEdit } from '@/features/tree/ContentOutliner'
import { ALL_NODES } from '@/features/tree/useNodeEditRefresh'
import { PublishButton } from '@/features/workspaces/PublishButton'
import { SyncWorkspaceButton } from '@/features/workspaces/SyncWorkspaceButton'
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

  // Editing always happens in the personal workspace, as in the classic UI.
  // The workspace switcher never changes this - it rebases the personal
  // workspace onto a different base (live or a shared workspace) and thereby
  // retargets where a publish goes.
  const workspaces = workspacesResponse?.workspaces ?? []
  const activeWorkspace =
    workspaces.find((w) => w.classification === 'PERSONAL') ?? null
  const baseTargets = workspaces.filter(
    (w) => w.classification === 'ROOT' || w.classification === 'SHARED',
  )

  const { data: dimensionsResponse } = useDimensions(auth === 'authenticated')
  const dimensions = dimensionsResponse?.dimensions ?? []
  // null = let the backend pick its default dimension space point; the sites
  // response reports the point actually in effect, which the switcher shows.
  const [dimensionSpacePoint, setDimensionSpacePoint] =
    useState<DimensionSpacePoint | null>(null)
  // Set when the user picked a dimension the selected document does not exist
  // in - the create-variant dialog is open for this target point.
  const [variantRequest, setVariantRequest] =
    useState<DimensionSpacePoint | null>(null)
  // Where the selected document exists; drives the switcher's muted "+" items.
  const { data: documentVariants } = useNodeVariants(
    selectedDocument?.address ?? null,
    auth === 'authenticated',
  )

  // Keep the user on the same document across a dimension switch: fetch the
  // node at its address in the target point and reselect it once it resolves.
  // The counter drops stale responses when dimensions change in quick
  // succession, so a slow earlier fetch cannot override the latest switch.
  const followDocumentRequest = useRef(0)
  const followDocumentInto = (
    previousAddress: string,
    point: DimensionSpacePoint,
  ) => {
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

  const { data: sitesResponse } = useSites(
    activeWorkspace?.name ?? null,
    dimensionSpacePoint,
    auth === 'authenticated',
  )

  const sites = sitesResponse?.sites ?? []
  const [siteNodeName, setSiteNodeName] = useState<string | null>(null)
  const activeSite =
    sites.find((s) => s.nodeName === siteNodeName) ??
    sites.find((s) => s.nodeAddress !== null) ??
    null

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
    return (
      <div className="grid min-h-screen place-items-center text-neutral-400">
        Loading Neos Studio…
      </div>
    )
  }

  if (auth === 'anonymous') {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="rounded-lg border bg-neutral-900 px-12 py-10 text-center">
          <h1 className="mb-1 text-2xl font-semibold">Neos Studio</h1>
          <p className="mb-6 text-neutral-400">Editing environment for Neos</p>
          {error && <p className="mb-4 text-red-500">{error}</p>}
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
      setLastEdit((prev) => ({
        addresses: [address],
        token: (prev?.token ?? 0) + 1,
      }))
      setPreviewReloadToken((token) => token + 1)
      // The inspected-node snapshot is stale now - the save already
      // invalidated the cache, so this refetches fresh values.
      fetchNode(address)
        .then(setInspectedNode)
        .catch(() => {
          /* fine - keep showing the previous snapshot */
        })
    },
    nodesEdited: (addresses) => {
      if (addresses.length === 0) return
      setLastEdit((prev) => ({
        addresses,
        token: (prev?.token ?? 0) + 1,
      }))
      // A move relocates rendered content - reload the preview so the element
      // appears in its new place.
      setPreviewReloadToken((token) => token + 1)
    },
    workspaceContentChanged: () => {
      setLastEdit((prev) => ({
        addresses: [ALL_NODES],
        token: (prev?.token ?? 0) + 1,
      }))
      setPreviewReloadToken((token) => token + 1)
      // The snapshots held in app state are re-read as well; a node that no
      // longer exists (created in the workspace, then discarded) is dropped.
      if (selectedDocument) {
        fetchNode(selectedDocument.address)
          .then(setSelectedDocument)
          .catch(() => {
            setSelectedDocument(null)
            setInspectedNode(null)
          })
      }
      if (inspectedNode) {
        fetchNode(inspectedNode.address)
          .then(setInspectedNode)
          .catch(() => setInspectedNode(null))
      }
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
        <ModalProvider>
          <PanelsProvider>
            <Sidebar>
              <SidebarHeader>
                <div className="flex items-center gap-2.5 px-2 py-1 text-lg">
                  <svg
                    viewBox="0 0 453.54 124.45"
                    className="h-6 w-auto shrink-0"
                    role="img"
                    aria-label="Neos"
                  >
                    <path
                      fill="currentColor"
                      d="M410.69 86l4.95-5.54c5.5 4.94 10.61 7.54 18.11 7.54 6.7 0 11.49-3.4 11.49-8.47 0-4.51-2.55-6.89-13.49-9.66-12.69-3.25-19.07-7.6-19.07-16.47 0-9.19 8.46-15.52 19.31-15.52 8.06 0 14 2.62 19.71 7.13l-4.63 5.94c-5.27-4.12-9.74-5.86-15.16-5.86-6.15 0-10.86 3-10.86 7.76 0 4.59 3 7.13 14.29 9.9 12.21 2.93 18.2 7.76 18.2 16.31 0 10-8.62 16.16-19.87 16.16-8.94 0-16.36-3.22-22.98-9.22zM327.77 66.55c0-15.68 12.13-28.67 29-28.67s29 13 29 28.67-12.13 28.67-29 28.67-29-12.99-29-28.67zm49.72 0c0-12.12-8.54-21.3-20.67-21.3s-20.67 9.19-20.67 21.3 8.54 21.3 20.67 21.3 20.67-9.19 20.67-21.3zM302.55 38.83V46h-32.72v16.67H299V70h-29.17v17.06h33.12v7.21h-41.18V38.83zM191.07 38.83l32.48 40.94V38.83h7.9v55.44h-6.62l-33.37-42.06v42.06h-7.9V38.83z"
                    />
                    <path
                      fill="#009fe3"
                      d="M88.83 0L68.12 15.1v31.57l20.71 29.28V0zM88.83 112.57L9.22 0 0 6.74v117.71l20.71-15.1V51.06l51.78 73.39h22.65l16.34-11.88H88.83z"
                    />
                    <path
                      fill="currentColor"
                      d="M20.71 51.06v58.29L0 124.45h22.65l20.71-15.1V83.17L20.71 51.06zM88.83 75.95V0h22.65v112.57H88.83L9.22 0h25.89l53.72 75.95z"
                    />
                  </svg>
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
                  <ModalLauncher />
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
                      allowedPoints={
                        dimensionsResponse?.allowedDimensionSpacePoints ?? []
                      }
                      value={
                        dimensionSpacePoint ?? sitesResponse.dimensionSpacePoint
                      }
                      documentCoverage={
                        selectedDocument
                          ? documentVariants?.coveredDimensionSpacePoints
                          : undefined
                      }
                      onCreateVariant={setVariantRequest}
                      onChange={(point) => {
                        const previousAddress =
                          selectedDocument?.address ?? null
                        setDimensionSpacePoint(point)
                        setSelectedDocument(null)
                        setInspectedNode(null)
                        if (previousAddress)
                          followDocumentInto(previousAddress, point)
                      }}
                    />
                  )}

                  <PreviewToolbar
                    document={selectedDocument}
                    editing={previewEditing}
                    onToggleEditing={() => setPreviewEditing((value) => !value)}
                    onReload={() => setPreviewReloadToken((token) => token + 1)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  {activeWorkspace && baseTargets.length > 0 && (
                    <WorkspaceSwitcher
                      personalWorkspace={activeWorkspace}
                      targets={baseTargets}
                    />
                  )}
                  {activeWorkspace && (
                    <>
                      <SyncWorkspaceButton
                        workspaceName={activeWorkspace.name}
                      />
                      <PublishButton workspace={activeWorkspace} />
                    </>
                  )}
                </div>
              </header>

              {error && <div className="px-4 py-2.5 text-red-500">{error}</div>}

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
                      const currentPoint =
                        dimensionSpacePoint ??
                        sitesResponse?.dimensionSpacePoint
                      if (
                        currentPoint &&
                        !dimensionSpacePointEquals(
                          node.dimensionSpacePoint,
                          currentPoint,
                        )
                      ) {
                        setDimensionSpacePoint(node.dimensionSpacePoint)
                      }
                      setSelectedDocument(node)
                      setInspectedNode(node)
                    })
                    .catch(() => {
                      /* fine - e.g. the linked document is not visible in this workspace */
                    })
                }}
                onNodeEdited={(address) =>
                  setLastEdit((prev) => ({
                    addresses: Array.isArray(address) ? address : [address],
                    token: (prev?.token ?? 0) + 1,
                  }))
                }
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
                    void queryClient.invalidateQueries({
                      queryKey: queryKeys.nodes.all,
                    })
                    void queryClient.invalidateQueries({
                      queryKey: queryKeys.workspaces.all,
                    })
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
        </ModalProvider>
      </StudioProvider>
    </SidebarProvider>
  )
}
