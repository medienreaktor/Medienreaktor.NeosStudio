import { useEffect, useMemo, useRef, useState } from 'react'
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
import {
  DOCUMENT_NODE_TYPE,
  fetchNode,
  isDeleted,
  type NodeDto,
  useNodeVariants,
} from '@/api/nodes'
import { isOfType, useNodeTypes } from '@/api/nodeTypes'
import {
  addressInDimension,
  addressInWorkspace,
  addressWithAggregateId,
  aggregateIdOf,
} from '@/api/nodeAddress'
import { useSites } from '@/api/sites'
import { useWorkspaces } from '@/api/workspaces'
import { queryClient } from '@/app/queryClient'
import { loadTranslations, translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/spinner'
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
import type { EditingElement } from '@/api/collaboration'
import { CollaborationBridge } from '@/features/collaboration/CollaborationBridge'
import { PresenceAvatars } from '@/features/collaboration/PresenceAvatars'
import {
  PresenceProvider,
  type PresencePeer,
} from '@/features/collaboration/PresenceContext'
import { CreateVariantDialog } from '@/features/dimensions/CreateVariantDialog'
import { DimensionSwitcher } from '@/features/dimensions/DimensionSwitcher'
import {
  AssetPickerPanelBridge,
  AssetPickerProvider,
} from '@/features/media/AssetPicker'
import { ModalLauncher } from '@/features/modals/ModalLauncher'
import { ModalProvider } from '@/features/modals/ModalHost'
import {
  PanelDock,
  PanelsProvider,
  SecondaryDock,
} from '@/features/panels/PanelSystem'
import { PreviewButton } from '@/features/preview/PreviewButton'
import { PreviewToolbar } from '@/features/preview/PreviewPane'
import { ShortcutHost } from '@/features/shortcuts/ShortcutHost'
import { NotificationBell } from '@/features/notifications/NotificationBell'
import { UserMenu } from '@/features/profile/UserMenu'
import { SiteSwitcher } from '@/features/sites/SiteSwitcher'
import type { NodeEdit } from '@/features/tree/ContentOutliner'
import { ALL_NODES } from '@/features/tree/useNodeEditRefresh'
import { ShareButton } from '@/features/sharing/ShareButton'
import { PublishButton } from '@/features/workspaces/PublishButton'
import { ReviewButton } from '@/features/workspaces/ReviewButton'
import { SyncWorkspaceButton } from '@/features/workspaces/SyncWorkspaceButton'
import { WorkspaceSwitcher } from '@/features/workspaces/WorkspaceSwitcher'

type AuthState = 'checking' | 'authenticated' | 'anonymous'

// Guards against a redirect loop if the silent auto-login ever fails:
// set before redirecting, cleared once tokens arrive.
const AUTO_LOGIN_KEY = 'neos-studio.auto_login_attempted'

// Remembers the selected document across reloads. Only the aggregate id is
// stored - the full address is bound to a workspace and dimension, so on reload
// the id is re-resolved against the current site's subgraph instead.
const SELECTED_DOCUMENT_KEY = 'neos-studio.selected_document'

// Remember the site and dimension the user was working in across reloads.
const SELECTED_SITE_KEY = 'neos-studio.selected_site'
const DIMENSION_SPACE_POINT_KEY = 'neos-studio.dimension_space_point'

// Remember a collaborative editing context (a shared workspace edited
// directly) across reloads; absent = the personal workspace.
const EDITING_WORKSPACE_KEY = 'neos-studio.editing_workspace'

// The stored point, or null (= let the backend pick its default) if nothing
// valid is stored. Structural check only - whether the point is still allowed
// by the dimension configuration is verified once the dimensions load.
function storedDimensionSpacePoint(): DimensionSpacePoint | null {
  try {
    const stored = localStorage.getItem(DIMENSION_SPACE_POINT_KEY)
    if (!stored) return null
    const parsed: unknown = JSON.parse(stored)
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.values(parsed).every((value) => typeof value === 'string')
    ) {
      return parsed as DimensionSpacePoint
    }
  } catch {
    /* fall through to the backend default */
  }
  return null
}

export function App() {
  const [auth, setAuth] = useState<AuthState>('checking')
  const [selectedDocument, setSelectedDocument] = useState<NodeDto | null>(null)
  // The node shown in the inspector drawer - a document or a content node.
  // Also the node outlined in the preview and revealed in the outliner.
  const [inspectedNode, setInspectedNode] = useState<NodeDto | null>(null)
  // The last inline edit from the preview; refreshes the outliner label.
  const [lastEdit, setLastEdit] = useState<NodeEdit | null>(null)
  // Bumped after inspector edits so the preview shows them (inline edits
  // already render live inside the iframe and need no reload).
  const [previewReloadToken, setPreviewReloadToken] = useState(0)
  // Inspector edits of ui.reloadIfChanged properties (and remote
  // collaborators' content edits): refresh just those nodes' elements in the
  // preview (out-of-band render) instead of a full reload.
  const [previewElementUpdate, setPreviewElementUpdate] = useState<{
    addresses: string[]
    token: number
  } | null>(null)

  // The me-query doubles as the token check (a 401 drives the logout below);
  // the user id additionally tells the collaboration feed which events are
  // the own ones.
  const { data: me, error: meError } = useMe(auth === 'authenticated')
  const { sidebarWidth, isResizing, resizeHandleProps } = useResizableSidebar()
  const { data: workspacesResponse } = useWorkspaces(auth === 'authenticated')

  // The editing context. Default (classic model): editing happens in the
  // personal workspace and the switcher only retargets where a publish goes
  // (rebases the personal workspace onto a different base). Collaborative
  // model: the switcher can instead point the editing context AT a shared
  // workspace - every command then runs directly against it, which is what
  // makes multiplayer editing work (all participants write into one event
  // log). Switching the editing context is a pure client-side state change:
  // no CR command, no empty-workspace requirement, personal pending changes
  // survive untouched.
  const workspaces = workspacesResponse?.workspaces ?? []
  const [editingWorkspaceName, setEditingWorkspaceName] = useState<
    string | null
  >(() => localStorage.getItem(EDITING_WORKSPACE_KEY))
  const personalWorkspace =
    workspaces.find((w) => w.classification === 'PERSONAL') ?? null
  const collaborativeWorkspace = editingWorkspaceName
    ? (workspaces.find(
        (w) =>
          w.name === editingWorkspaceName &&
          w.classification === 'SHARED' &&
          w.permissions.write,
      ) ?? null)
    : null
  const activeWorkspace = collaborativeWorkspace ?? personalWorkspace
  const baseTargets = workspaces.filter(
    (w) => w.classification === 'ROOT' || w.classification === 'SHARED',
  )

  // A remembered collaborative context that no longer resolves (workspace
  // deleted, write access revoked) falls back to the personal workspace.
  useEffect(() => {
    if (!workspacesResponse || editingWorkspaceName === null) return
    const stillValid = workspacesResponse.workspaces.some(
      (w) =>
        w.name === editingWorkspaceName &&
        w.classification === 'SHARED' &&
        w.permissions.write,
    )
    if (!stillValid) {
      setEditingWorkspaceName(null)
      localStorage.removeItem(EDITING_WORKSPACE_KEY)
    }
  }, [workspacesResponse, editingWorkspaceName])

  // Who else is in the collaborative session (fed by the bridge below).
  const [presence, setPresence] = useState<{
    peers: PresencePeer[]
    you: string | null
  }>({ peers: [], you: null })

  // The content element the user has SELECTED - their edit-lock claim.
  // Selection is the claim unit (no need to be typing): it survives window
  // switches naturally and matches "I am working on this element". Documents
  // are never claimed - they are the shared canvas of the multiplayer
  // session. Server-side arbitration grants each element to the earliest
  // claim; releasing (selecting elsewhere) auto-promotes the next claimant.
  const { data: nodeTypeMap } = useNodeTypes(auth === 'authenticated')
  const editingElement = useMemo<EditingElement | null>(() => {
    if (!inspectedNode || !nodeTypeMap) return null
    if (isOfType(nodeTypeMap, inspectedNode.nodeType, DOCUMENT_NODE_TYPE))
      return null
    return {
      nodeAggregateId: aggregateIdOf(inspectedNode.address),
      property: null,
    }
  }, [inspectedNode, nodeTypeMap])

  const { data: dimensionsResponse } = useDimensions(auth === 'authenticated')
  const dimensions = dimensionsResponse?.dimensions ?? []
  // null = let the backend pick its default dimension space point; the sites
  // response reports the point actually in effect, which the switcher shows.
  // Starts from the point remembered across reloads, if any.
  const [dimensionSpacePoint, setDimensionSpacePoint] =
    useState<DimensionSpacePoint | null>(storedDimensionSpacePoint)

  // Remember the dimension across reloads. A restored point that the current
  // dimension configuration no longer allows (config changed since it was
  // stored) is dropped in favor of the backend default.
  const allowedPoints = dimensionsResponse?.allowedDimensionSpacePoints
  useEffect(() => {
    if (!dimensionSpacePoint) return
    if (
      allowedPoints &&
      !allowedPoints.some((point) =>
        dimensionSpacePointEquals(point, dimensionSpacePoint),
      )
    ) {
      localStorage.removeItem(DIMENSION_SPACE_POINT_KEY)
      setDimensionSpacePoint(null)
      return
    }
    localStorage.setItem(
      DIMENSION_SPACE_POINT_KEY,
      JSON.stringify(dimensionSpacePoint),
    )
  }, [dimensionSpacePoint, allowedPoints])
  // Set when the user picked a dimension the selected document does not exist
  // in - the create-variant dialog is open for this target point.
  const [variantRequest, setVariantRequest] =
    useState<DimensionSpacePoint | null>(null)
  // Where the selected document exists; drives the switcher's muted "+" items.
  const { data: documentVariants } = useNodeVariants(
    selectedDocument?.address ?? null,
    auth === 'authenticated',
  )

  // Keep the user on the same document across a dimension or editing-context
  // switch: fetch the node at its address in the target subgraph and reselect
  // it once it resolves. The counter drops stale responses when switches
  // happen in quick succession, so a slow earlier fetch cannot override the
  // latest one.
  const followDocumentRequest = useRef(0)
  const followDocumentTo = (targetAddress: string) => {
    const request = ++followDocumentRequest.current
    fetchNode(targetAddress)
      .then((node) => {
        if (followDocumentRequest.current !== request) return
        setSelectedDocument(node)
        setInspectedNode(node)
      })
      .catch(() => {
        /* fine - the tree simply starts unselected */
      })
  }
  const followDocumentInto = (
    previousAddress: string,
    point: DimensionSpacePoint,
  ) => followDocumentTo(addressInDimension(previousAddress, point))

  /**
   * Move the editing context to a shared workspace (name) or back to the
   * personal one (null). Client-side only; the selected document follows
   * into the target workspace's subgraph.
   */
  const switchEditingContext = (name: string | null) => {
    const targetName = name ?? personalWorkspace?.name ?? null
    if (targetName === null || targetName === activeWorkspace?.name) return
    setEditingWorkspaceName(name)
    if (name !== null) localStorage.setItem(EDITING_WORKSPACE_KEY, name)
    else localStorage.removeItem(EDITING_WORKSPACE_KEY)
    const previousAddress = selectedDocument?.address ?? null
    setSelectedDocument(null)
    setInspectedNode(null)
    if (previousAddress)
      followDocumentTo(addressInWorkspace(previousAddress, targetName))
  }

  /**
   * A followed link or review row: show the target document; trees reveal and
   * select it. Links can cross dimensions (e.g. a language menu) - follow the
   * switch so the trees browse the same dimension as the preview.
   */
  const navigateToNode = (address: string) => {
    fetchNode(address)
      .then((node) => {
        const currentPoint =
          dimensionSpacePoint ?? sitesResponse?.dimensionSpacePoint
        if (
          currentPoint &&
          !dimensionSpacePointEquals(node.dimensionSpacePoint, currentPoint)
        ) {
          setDimensionSpacePoint(node.dimensionSpacePoint)
        }
        setSelectedDocument(node)
        setInspectedNode(node)
      })
      .catch(() => {
        /* fine - e.g. the linked document is not visible in this workspace */
      })
  }

  /**
   * Show a document that lives in another workspace (the review dialog's
   * "go to page" on a non-active source): move the editing context to that
   * workspace first - personal, or a writable shared one (collaborative) -
   * then navigate to the address, which is already bound to it.
   */
  const navigateToNodeInWorkspace = (address: string, name: string) => {
    if (activeWorkspace && name !== activeWorkspace.name) {
      const editingName = name === personalWorkspace?.name ? null : name
      setEditingWorkspaceName(editingName)
      if (editingName !== null)
        localStorage.setItem(EDITING_WORKSPACE_KEY, editingName)
      else localStorage.removeItem(EDITING_WORKSPACE_KEY)
      setSelectedDocument(null)
      setInspectedNode(null)
    }
    navigateToNode(address)
  }

  const { data: sitesResponse } = useSites(
    activeWorkspace?.name ?? null,
    dimensionSpacePoint,
    auth === 'authenticated',
  )

  // The editing shell only deals in online sites; offline ones exist solely
  // for the sites administration (which fetches the full listing itself).
  const sites = (sitesResponse?.sites ?? []).filter(
    (site) => site.state === 'online',
  )
  // Starts from the site remembered across reloads; a stored name that no
  // longer matches simply falls back to the first site below.
  const [siteNodeName, setSiteNodeName] = useState<string | null>(() =>
    localStorage.getItem(SELECTED_SITE_KEY),
  )
  const activeSite =
    sites.find((s) => s.nodeName === siteNodeName) ??
    sites.find((s) => s.nodeAddress !== null) ??
    null

  useEffect(() => {
    if (siteNodeName) localStorage.setItem(SELECTED_SITE_KEY, siteNodeName)
  }, [siteNodeName])

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
        toast.error(e, { title: t('app.loginFailed', 'Login failed') })
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

  // Remember the selected document so a reload lands on it again. Persist just
  // the aggregate id; the address itself is workspace/dimension-bound.
  useEffect(() => {
    if (!selectedDocument) return
    localStorage.setItem(
      SELECTED_DOCUMENT_KEY,
      aggregateIdOf(selectedDocument.address),
    )
  }, [selectedDocument])

  // Restore the remembered document once the active site is known (its address
  // carries the current workspace and dimension). A stored id that no longer
  // resolves, and the no-stored-id case, both fall back to the site's root
  // document node. Runs once per load - dimension and site switches drive their
  // own reselection and must not be overridden here.
  const didRestoreSelection = useRef(false)
  const siteAddress = activeSite?.nodeAddress ?? null
  useEffect(() => {
    if (didRestoreSelection.current || !siteAddress) return
    didRestoreSelection.current = true
    const select = (node: NodeDto) => {
      setSelectedDocument(node)
      setInspectedNode(node)
    }
    const selectRoot = () => {
      fetchNode(siteAddress)
        .then(select)
        .catch(() => {
          /* fine - the tree simply starts unselected */
        })
    }
    const storedId = localStorage.getItem(SELECTED_DOCUMENT_KEY)
    if (!storedId) {
      selectRoot()
      return
    }
    fetchNode(addressWithAggregateId(siteAddress, storedId))
      .then(select)
      .catch(selectRoot)
  }, [siteAddress])

  if (auth === 'checking') {
    return (
      <div className="grid min-h-screen place-items-center">
        <LoadingState label={t('app.loadingStudio', 'Loading Neos Studio…')} />
      </div>
    )
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

  // The workspace's content changed wholesale (published/discarded/rebased,
  // locally or by a collaborator): refresh every cached node read, all tree
  // items, the preview, and the app-state snapshots. A snapshot that no
  // longer resolves (the node was removed) is deselected gracefully.
  const refreshWorkspaceContent = () => {
    setLastEdit((prev) => ({
      addresses: [ALL_NODES],
      token: (prev?.token ?? 0) + 1,
    }))
    setPreviewReloadToken((token) => token + 1)
    // A DELETED node (opened from the trash) has to be re-read with the same
    // opt-in it was selected with, or the refresh would drop the selection just
    // because the node is deleted. It still drops when the read fails for real
    // - the node was published away and is gone.
    if (selectedDocument) {
      fetchNode(
        selectedDocument.address,
        undefined,
        isDeleted(selectedDocument),
      )
        .then(setSelectedDocument)
        .catch(() => {
          setSelectedDocument(null)
          setInspectedNode(null)
        })
    }
    if (inspectedNode) {
      fetchNode(inspectedNode.address, undefined, isDeleted(inspectedNode))
        .then(setInspectedNode)
        .catch(() => setInspectedNode(null))
    }
  }

  // A collaborator's content edits (property/reference changes): swap the
  // affected elements in the preview out-of-band, refresh their tree rows and
  // the inspector snapshot if it shows one of them. The cached reads must be
  // dropped first - the refreshes below would otherwise serve the 30s-stale
  // query cache.
  const remoteContentChanged = (aggregateIds: string[]) => {
    const baseAddress =
      selectedDocument?.address ?? activeSite?.nodeAddress ?? null
    if (!baseAddress) return
    const addresses = aggregateIds.map((id) =>
      addressWithAggregateId(baseAddress, id),
    )
    for (const address of addresses) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.nodes.node(address),
      })
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
    setLastEdit((prev) => ({ addresses, token: (prev?.token ?? 0) + 1 }))
    setPreviewElementUpdate((prev) => ({
      addresses,
      token: (prev?.token ?? 0) + 1,
    }))
    if (
      inspectedNode &&
      aggregateIds.includes(aggregateIdOf(inspectedNode.address))
    ) {
      fetchNode(inspectedNode.address)
        .then(setInspectedNode)
        .catch(() => setInspectedNode(null))
    }
  }

  // A collaborator changed the structure (or published/discarded/rebased the
  // session): incremental updates cannot describe this - drop all caches and
  // refresh wholesale.
  const remoteWorkspaceChanged = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
    refreshWorkspaceContent()
  }

  // The app state and actions panels read via useStudio(). Panels register
  // themselves in the panel registry (see features/panels/builtin.tsx); their
  // placement (sidebar dock, floating, tab grouping) is the panel system's
  // business.
  const studio: StudioContextValue = {
    site: activeSite,
    workspaceName: activeWorkspace?.name ?? null,
    personalWorkspaceName: personalWorkspace?.name ?? null,
    selectedDocument,
    inspectedNode,
    lastEdit,
    previewReloadToken,
    previewElementUpdate,
    selectDocument: (node) => {
      setSelectedDocument(node)
      setInspectedNode(node)
    },
    inspectNode: setInspectedNode,
    inspectAddress: (address) => {
      // A click in the preview: inspect the node and reveal it in the outliner
      // (via inspectedNode). Fine to fail - e.g. the node vanished meanwhile.
      fetchNode(address)
        .then(setInspectedNode)
        .catch(() => {})
    },
    navigateToNode,
    navigateToNodeInWorkspace,
    checkoutWorkspace: (name) =>
      switchEditingContext(name === personalWorkspace?.name ? null : name),
    reportInlineEdit: (addresses) => {
      setLastEdit((prev) => ({
        addresses,
        token: (prev?.token ?? 0) + 1,
      }))
    },
    nodeEdited: (address, options) => {
      setLastEdit((prev) => ({
        addresses: [address],
        token: (prev?.token ?? 0) + 1,
      }))
      // How the preview refreshes follows the property's configuration:
      // 'page' (ui.reloadPageIfChanged, and the default for anything not an
      // inspector property save) reloads the iframe, 'element'
      // (ui.reloadIfChanged) re-renders just the node's element out-of-band,
      // 'none' (neither flag) leaves the preview alone.
      const reload = options?.reload ?? 'page'
      if (reload === 'page') {
        setPreviewReloadToken((token) => token + 1)
      } else if (reload === 'element') {
        setPreviewElementUpdate((prev) => ({
          addresses: [address],
          token: (prev?.token ?? 0) + 1,
        }))
      }
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
    workspaceContentChanged: refreshWorkspaceContent,
  }

  return (
    <SidebarProvider
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
      // The shell fills the viewport exactly and never scrolls as a whole: this
      // bounds the height so every flex-1/min-h-0 chain below resolves against
      // it, and scrolling happens inside the panels (and the preview iframe),
      // not on the outer page.
      className={cn(
        'h-svh overflow-hidden',
        isResizing &&
          'select-none **:data-[slot=sidebar-container]:transition-none! **:data-[slot=sidebar-gap]:transition-none!',
      )}
    >
      <StudioProvider value={studio}>
        <PresenceProvider
          value={{
            active: collaborativeWorkspace !== null,
            peers: collaborativeWorkspace !== null ? presence.peers : [],
            you: presence.you,
          }}
        >
          <ModalProvider>
            {/* AssetPickerProvider wraps PanelsProvider so editors inside floating
              panels (the Inspector is portalled out by the panel system) can
              still open the asset picker; the bridge inside does the tab switch. */}
            <AssetPickerProvider>
              <PanelsProvider floatingVisibleForMainPanel="visual-editor">
                {/* Keydown dispatcher + shell-level shortcuts + the overview
                  dialog. Inside ModalProvider and SidebarProvider so the
                  settings and sidebar shortcuts reach their contexts. */}
                <ShortcutHost />
                <AssetPickerPanelBridge />
                {/* The collaborative session's engine: presence heartbeats and
                  the change-feed tail. Mounted (and thus polling) only while
                  the editing context is a shared workspace. */}
                {collaborativeWorkspace && (
                  <CollaborationBridge
                    workspaceName={collaborativeWorkspace.name}
                    ownUserId={me?.user?.id ?? null}
                    documentAggregateId={
                      selectedDocument
                        ? aggregateIdOf(selectedDocument.address)
                        : null
                    }
                    focusedAggregateId={
                      inspectedNode
                        ? aggregateIdOf(inspectedNode.address)
                        : null
                    }
                    dimensionSpacePoint={
                      dimensionSpacePoint ??
                      sitesResponse?.dimensionSpacePoint ??
                      null
                    }
                    editingElement={editingElement}
                    onPresence={setPresence}
                    onRemoteContentChange={remoteContentChanged}
                    onRemoteWorkspaceChange={remoteWorkspaceChanged}
                  />
                )}
                <Sidebar>
                  {/* Fixed to the main header's height (h-14, plus an
                    invisible border matching its border-b) so the row does
                    not shift when the avatar mounts after /me resolves. */}
                  <SidebarHeader className="h-12 shrink-0 justify-center border-b border-transparent">
                    <div className="flex items-center justify-between gap-2.5 px-2 pt-2">
                      <svg
                        viewBox="0 0 254 98"
                        className="-mt-1 h-8 w-auto shrink-0"
                        role="img"
                        aria-label="Neos"
                      >
                        <path
                          d="M16 33.7913L55 88.5959L41.3896 97.7942L16 61.5334V97.7913H0V33.7913H16Z"
                          fill="#009FE3"
                        />
                        <path
                          d="M108.85 89.2039C101.776 89.2039 95.944 85.5319 94 80.5099L98.482 78.188C100.21 82.13 104.044 84.6139 108.85 84.6139C113.17 84.6139 116.572 82.67 117.814 79.8619V76.2439C117.058 74.4619 115.492 73.1119 113.062 72.3019C109.39 71.0599 106.852 71.4919 102.694 70.0879C98.752 68.7379 96.052 66.3079 94.918 63.3919V57.2359C96.808 52.6999 102.208 49.4059 108.688 49.4059C115.438 49.4059 121.054 52.8619 123.052 57.9919L118.57 60.2599C116.95 56.4259 113.278 54.0499 108.688 54.0499C104.638 54.0499 101.29 55.8859 100.048 58.7479V61.8799C100.804 63.6619 102.316 64.9039 104.746 65.7139C108.364 66.9019 110.956 66.5239 115.114 67.9279C119.056 69.278 121.81 71.7619 122.944 74.7319V81.374C121.108 85.856 115.546 89.2039 108.85 89.2039Z"
                          className="fill-neutral-950 dark:fill-white"
                        />
                        <path
                          d="M140.967 88.7719C135.945 88.7719 132.867 86.8279 131.139 83.4259V64.1479H125.307V60.2059H128.871C130.059 60.2059 130.815 59.7739 131.139 58.9639V51.2959H135.891V60.2059H144.045V64.1479H135.891V81.32C136.701 83.156 138.267 84.3439 141.669 84.3439H144.207V88.394C143.397 88.61 142.101 88.7719 140.967 88.7719Z"
                          className="fill-neutral-950 dark:fill-white"
                        />
                        <path
                          d="M168.625 60.2059H173.377V88.394H168.841V85.3159C166.843 87.6919 163.927 89.2039 160.039 89.2039C154.369 89.2039 150.049 85.8019 148.645 81.7519V60.2059H153.397V80.4019C154.423 82.8319 157.015 84.722 161.065 84.722C164.899 84.722 167.923 82.5619 168.625 80.1859V60.2059Z"
                          className="fill-neutral-950 dark:fill-white"
                        />
                        <path
                          d="M202.113 48.9739H206.865V88.394H202.329V84.992C200.115 87.584 196.767 89.2039 192.609 89.2039C186.237 89.2039 181.107 85.2079 179.541 79.9699V68.5759C181.107 63.3379 186.237 59.3419 192.609 59.3419C196.605 59.3419 199.899 60.9079 202.113 63.3379V48.9739ZM202.113 79.9699V68.6299C200.655 65.8759 197.361 63.8239 193.311 63.8239C188.721 63.8239 185.157 66.6319 184.293 69.8719V78.674C185.157 81.968 188.721 84.776 193.311 84.776C197.361 84.776 200.655 82.6699 202.113 79.9699Z"
                          className="fill-neutral-950 dark:fill-white"
                        />
                        <path
                          d="M216.661 54.8599C215.203 54.8599 213.907 54.1579 213.367 53.1319V50.3239C213.907 49.2979 215.203 48.5959 216.661 48.5959C218.119 48.5959 219.415 49.2979 219.955 50.3239V53.1319C219.415 54.1579 218.119 54.8599 216.661 54.8599ZM214.285 88.394V60.2059H219.037V88.394H214.285Z"
                          className="fill-neutral-950 dark:fill-white"
                        />
                        <path
                          d="M239.277 89.2579C232.473 89.2579 226.965 85.2079 225.291 79.9699V68.5759C226.965 63.3379 232.473 59.3419 239.277 59.3419C246.027 59.3419 251.535 63.3379 253.209 68.5759V79.9699C251.535 85.2079 246.027 89.2579 239.277 89.2579ZM239.277 84.776C243.813 84.776 247.539 81.968 248.457 78.674V69.8719C247.539 66.6319 243.813 63.8239 239.277 63.8239C234.687 63.8239 230.961 66.6319 230.043 69.8719V78.674C230.961 81.968 234.687 84.776 239.277 84.776Z"
                          className="fill-neutral-950 dark:fill-white"
                        />
                        <path
                          d="M97.5 17.5959L22 3.59595L68.5 67.5959V35.0959L97.5 17.5959Z"
                          className="fill-neutral-50 dark:fill-[#141414]"
                        />
                        <path
                          d="M106.999 16.2666L70.6943 36.4883L70.5557 76.7373L16 0L106.999 16.2666ZM65.6094 61.1514L65.7051 33.5439L92.3164 18.7207L27.1641 7.07422L65.6094 61.1514Z"
                          className="fill-neutral-950 dark:fill-white"
                        />
                      </svg>

                      <div className="flex items-center gap-1">
                        <NotificationBell />
                        <UserMenu />
                      </div>
                    </div>
                  </SidebarHeader>
                  <SidebarContent className="overflow-hidden p-2">
                    <PanelDock region="sidebar" />
                  </SidebarContent>
                  <SidebarResizeHandle {...resizeHandleProps} />
                </Sidebar>

                <SidebarInset>
                  {/* Fixed height so the bar does not jump as the switchers and
                    workspace buttons resolve and render after load. */}
                  <header className="@container flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        <SidebarTrigger />
                        <ModalLauncher />
                      </div>
                      {sites.length > 0 && (
                        <SiteSwitcher
                          sites={sites}
                          value={activeSite?.nodeName ?? null}
                          onChange={(nodeName) => {
                            setSiteNodeName(nodeName)
                            setSelectedDocument(null)
                            setInspectedNode(null)
                            // The stored document belongs to the previous site -
                            // a reload should land on the new site's root, not
                            // re-resolve a document from the old one.
                            localStorage.removeItem(SELECTED_DOCUMENT_KEY)
                          }}
                        />
                      )}
                      {dimensions.length > 0 && sitesResponse && (
                        <DimensionSwitcher
                          dimensions={dimensions}
                          allowedPoints={
                            dimensionsResponse?.allowedDimensionSpacePoints ??
                            []
                          }
                          value={
                            dimensionSpacePoint ??
                            sitesResponse.dimensionSpacePoint
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
                        onReload={() => {
                          // Reload the preview, both trees and the inspector
                          // together. Everything serves stale content while the
                          // fresh data is in flight: drop the cached node reads,
                          // then the trees invalidate optimistically (ALL_NODES
                          // keeps existing rows until refetch resolves) and the
                          // inspected-node / document snapshots are only swapped
                          // once fetchNode resolves - so nothing blanks mid-reload.
                          void queryClient.invalidateQueries({
                            queryKey: queryKeys.nodes.all,
                          })
                          setLastEdit((prev) => ({
                            addresses: [ALL_NODES],
                            token: (prev?.token ?? 0) + 1,
                          }))
                          setPreviewReloadToken((token) => token + 1)
                          if (selectedDocument) {
                            fetchNode(selectedDocument.address)
                              .then(setSelectedDocument)
                              .catch(() => {
                                /* keep showing the previous snapshot */
                              })
                          }
                          if (inspectedNode) {
                            fetchNode(inspectedNode.address)
                              .then(setInspectedNode)
                              .catch(() => {
                                /* keep showing the previous snapshot */
                              })
                          }
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <PresenceAvatars />
                      {personalWorkspace &&
                        activeWorkspace &&
                        baseTargets.length > 0 && (
                          <WorkspaceSwitcher
                            personalWorkspace={personalWorkspace}
                            activeWorkspace={activeWorkspace}
                            targets={baseTargets}
                            onSwitchEditingContext={switchEditingContext}
                          />
                        )}
                      {selectedDocument && (
                        <>
                          <PreviewButton document={selectedDocument} />
                          <ShareButton document={selectedDocument} />
                        </>
                      )}
                      {activeWorkspace && (
                        <>
                          <SyncWorkspaceButton
                            workspaceName={activeWorkspace.name}
                          />
                          <ReviewButton
                            workspaces={workspaces}
                            activeWorkspace={activeWorkspace}
                            onNavigate={navigateToNodeInWorkspace}
                          />
                          <PublishButton workspace={activeWorkspace} />
                        </>
                      )}
                    </div>
                  </header>

                  {/* The main area and the optional right-hand sidebar. The Visual
                  Editor (preview) and Media Library live here as panels; the
                  secondary dock belongs to the Visual Editor, so it only shows
                  while that is the active main tab - not for the Media Library. */}
                  <div className="flex min-h-0 flex-1">
                    <PanelDock region="main" />
                    <SecondaryDock visibleForMainPanel="visual-editor" />
                  </div>

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
            </AssetPickerProvider>
          </ModalProvider>
        </PresenceProvider>
      </StudioProvider>
    </SidebarProvider>
  )
}
