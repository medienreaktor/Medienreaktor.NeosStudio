import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useMe } from '@/api/neos/endpoints/me'
import { DOCUMENT_NODE_TYPE } from '@/api/neos/endpoints/nodes'
import { isOfType, useNodeTypes } from '@/api/neos/endpoints/nodeTypes'
import { siteNodeAddress } from '@/api/neos/endpoints/sites'
import { neosKeys } from '@/api/neos/keys'
import {
  nodeAddressOf,
  sameDimensionSpacePoint,
  type NodeAddress,
} from '@/api/neos/schema'
import type { EditingElement } from '@/features/collaboration/types'
import { useTaskDecorationData } from '@/features/tasks/decorationData'
import {
  invalidateAfterContentEdit,
  invalidateWorkspaceQueries,
} from '@/features/workspaces/invalidate'
import { queryClient } from '@/app/queryClient'
import { cn } from '@/lib/utils'
import { AuthGate } from '@/app/AuthGate'
import { BootOverlay } from '@/app/BootOverlay'
import { reportNothingToPreview } from '@/app/boot'
import { NeosLogo } from '@/app/NeosLogo'
import { ShellHeader } from '@/app/ShellHeader'
import {
  StudioProvider,
  type StudioActions,
  type StudioState,
} from '@/app/StudioContext'
import { useEditingContext } from '@/app/useEditingContext'
import { useEditSignals } from '@/app/useEditSignals'
import { useSelection } from '@/app/useSelection'
import { useStableCallbacks } from '@/app/useStableCallbacks'
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
} from '@/components/ui/sidebar'
import { CollaborationBridge } from '@/features/collaboration/CollaborationBridge'
import {
  PresenceProvider,
  type PresencePeer,
  type PresenceState,
} from '@/features/collaboration/PresenceContext'
import { useAccess } from '@/features/access/useAccess'
import { WorkspaceLockoutDialog } from '@/features/access/WorkspaceLockoutDialog'
import {
  AssetPickerPanelBridge,
  AssetPickerProvider,
} from '@/features/media/AssetPicker'
import { ModalProvider } from '@/features/modals/ModalHost'
import { LegacyModulesMenu } from '@/features/navigation/LegacyModulesMenu'
import {
  PanelDock,
  PanelsProvider,
  SecondaryDock,
} from '@/features/panels/PanelSystem'
import { ShortcutHost } from '@/features/shortcuts/ShortcutHost'
import { NotificationBell } from '@/features/notifications/NotificationBell'
import { UserMenu } from '@/features/profile/UserMenu'
import { ALL_NODES } from '@/features/tree/useNodeEditRefresh'

export function App() {
  return (
    <AuthGate>
      <Shell />
    </AuthGate>
  )
}

/**
 * The authenticated shell: the editing context (site, workspace, dimension),
 * the selection, and the signals edits send to the trees and the preview -
 * handed to the panels through the studio context - around the sidebar, the
 * header and the panel docks.
 */
function Shell() {
  // The user id tells the collaboration feed which events are the own ones.
  const { data: me } = useMe()
  const { sidebarWidth, isResizing, resizeHandleProps } = useResizableSidebar()
  // The task data the workspace decorators badge task branches with.
  useTaskDecorationData()
  const access = useAccess()

  const editing = useEditingContext()
  const {
    site,
    personalWorkspace,
    collaborativeWorkspace,
    activeWorkspace,
    dimensionSpacePoint,
  } = editing
  useEffect(() => {
    if (editing.noSiteToOpen) reportNothingToPreview()
  }, [editing.noSiteToOpen])

  // The site node in the editing context: where the selection is restored
  // (once the context has resolved), and what remote changes resolve against
  // while no document is selected.
  const siteAddress =
    site && activeWorkspace && dimensionSpacePoint
      ? siteNodeAddress(site, activeWorkspace.name, dimensionSpacePoint)
      : null
  const selection = useSelection(siteAddress)
  const selectedDocument = selection.document
  const inspectedNode = selection.inspected
  const signals = useEditSignals()

  // The dimension as of the latest commit, for reads that resolve later.
  const currentDimension = useRef(dimensionSpacePoint)
  useLayoutEffect(() => {
    currentDimension.current = dimensionSpacePoint
  }, [dimensionSpacePoint])

  // Who else is in the collaborative session (fed by the bridge below).
  const [presence, setPresence] = useState<{
    peers: PresencePeer[]
    you: string | null
  }>({ peers: [], you: null })
  const presenceState = useMemo<PresenceState>(
    () => ({
      active: collaborativeWorkspace !== null,
      peers: collaborativeWorkspace !== null ? presence.peers : [],
      you: presence.you,
    }),
    [collaborativeWorkspace, presence],
  )

  // The content element the user has SELECTED - their edit-lock claim.
  // Selection is the claim unit (no need to be typing): it survives window
  // switches naturally and matches "I am working on this element". Documents
  // are never claimed - they are the shared canvas of the multiplayer
  // session. Server-side arbitration grants each element to the earliest
  // claim; releasing (selecting elsewhere) auto-promotes the next claimant.
  const { data: nodeTypeMap } = useNodeTypes('')
  const editingElement = useMemo<EditingElement | null>(() => {
    if (!inspectedNode || !nodeTypeMap) return null
    if (isOfType(nodeTypeMap, inspectedNode.nodeType, DOCUMENT_NODE_TYPE))
      return null
    return {
      nodeAggregateId: inspectedNode.nodeAggregateId,
      property: null,
    }
  }, [inspectedNode, nodeTypeMap])

  /**
   * Move the editing context to a shared workspace (name) or back to the
   * personal one (null). Client-side only; the selected document follows
   * into the target workspace's subgraph.
   */
  const switchEditingContext = (name: string | null) => {
    const targetName = name ?? personalWorkspace?.name ?? null
    if (targetName === null || targetName === activeWorkspace?.name) return
    editing.setEditingWorkspace(name)
    selection.follow({ workspaceName: targetName })
  }

  /** Switch the dimension; the selected document follows into it. */
  const changeDimension = (point: string) => {
    editing.setDimensionSpacePoint(point)
    selection.follow({ dimensionSpacePoint: point })
  }

  /**
   * A followed link or review row: show the target document; trees reveal and
   * select it. Links can cross dimensions (e.g. a language menu) - follow the
   * switch so the trees browse the same dimension as the preview. Compared
   * when the document has resolved, against the dimension as it is then.
   */
  const navigateToNode = (address: NodeAddress) =>
    selection.navigateTo(address, (node) => {
      const currentPoint = currentDimension.current
      if (
        currentPoint &&
        !sameDimensionSpacePoint(node.dimensionSpacePoint, currentPoint)
      ) {
        editing.setDimensionSpacePoint(node.dimensionSpacePoint)
      }
    })

  /**
   * Show a document that lives in another workspace (the review dialog's
   * "go to page" on a non-active source): move the editing context to that
   * workspace first - personal, or a writable shared one (collaborative) -
   * then navigate to the address, which is already bound to it.
   */
  const navigateToNodeInWorkspace = (address: NodeAddress, name: string) => {
    if (activeWorkspace && name !== activeWorkspace.name) {
      editing.setEditingWorkspace(
        name === personalWorkspace?.name ? null : name,
      )
      selection.clear()
    }
    navigateToNode(address)
  }

  // Drop the cached node reads of one workspace (of the active site's content
  // repository) - a change confined to it leaves every other one's valid.
  const invalidateWorkspaceNodes = (name: string | undefined) => {
    if (!site || name === undefined) return
    void queryClient.invalidateQueries({
      queryKey: neosKeys.nodes.workspace(site.contentRepositoryId, name),
    })
  }

  // The workspace's content changed wholesale (published/discarded/rebased,
  // locally or by a collaborator): refresh all tree items and the preview.
  // The callers drop the cached node reads, which re-reads the selection too -
  // a selected node that no longer resolves (published away) reads as none.
  const refreshWorkspaceContent = () => {
    signals.reportEdit([ALL_NODES])
    signals.reloadPreview()
  }

  // The app state and actions panels read via useStudio(). Panels register
  // themselves in the panel registry (see features/panels/builtin.tsx); their
  // placement (sidebar dock, floating, tab grouping) is the panel system's
  // business. The actions keep their identity, the state changes only with
  // what it holds - the panels re-render when there is something new to show.
  const actions = useStableCallbacks<StudioActions>({
    selectDocument: selection.selectDocument,
    inspectNode: selection.inspectNode,
    // A click in the preview: inspect the node and reveal it in the outliner
    // (via inspectedNode). Fine to fail - e.g. the node vanished meanwhile.
    inspectAddress: selection.inspectAddress,
    navigateToNode,
    navigateToNodeInWorkspace,
    checkoutWorkspace: (name) =>
      switchEditingContext(name === personalWorkspace?.name ? null : name),
    reportInlineEdit: (addresses) => signals.reportEdit(addresses),
    nodeEdited: (address, options) => {
      signals.reportEdit([address])
      // How the preview refreshes follows the property's configuration:
      // 'page' (ui.reloadPageIfChanged, and the default for anything not an
      // inspector property save) reloads the iframe, 'element'
      // (ui.reloadIfChanged) re-renders just the node's element out-of-band,
      // 'none' (neither flag) leaves the preview alone.
      const reload = options?.reload ?? 'page'
      if (reload === 'page') signals.reloadPreview()
      else if (reload === 'element') signals.updatePreviewElements([address])
      // The node's reads are stale now, the inspected node's among them. A
      // save usually invalidated them already - a refetch it started is not
      // restarted.
      void queryClient.invalidateQueries(
        { queryKey: neosKeys.nodes.node(address) },
        { cancelRefetch: false },
      )
      void invalidateAfterContentEdit(
        address.contentRepositoryId,
        address.workspaceName,
      )
    },
    nodesEdited: (addresses) => {
      if (addresses.length === 0) return
      signals.reportEdit(addresses)
      // A move relocates rendered content - reload the preview so the element
      // appears in its new place.
      signals.reloadPreview()
    },
    workspaceContentChanged: refreshWorkspaceContent,
  })

  // The shell's own handlers, stable for the same reason: the bridge and the
  // header take them as props.
  const handlers = useStableCallbacks({
    switchEditingContext,
    changeDimension,
    selectSite: (nodeName: string) => {
      const next = editing.sites.find((s) => s.nodeName === nodeName)
      if (!next) return
      editing.selectSite(next)
      // The stored document belongs to the previous site - a reload should
      // land on the new site's root, not re-resolve a document from the old
      // one.
      selection.clear({ forget: true })
    },
    variantCreated: (point: string) => {
      // The new variants exist now - drop the workspace's cached node reads
      // and its pending changes before anything refetches.
      if (site && activeWorkspace) {
        invalidateWorkspaceNodes(activeWorkspace.name)
        void invalidateAfterContentEdit(
          site.contentRepositoryId,
          activeWorkspace.name,
        )
      }
      // Follow the document into its new dimension so outliner and inspector
      // show the just-created variant right away.
      changeDimension(point)
    },
    reload: () => {
      // Reload the preview, both trees and the inspector together. Nothing
      // blanks meanwhile: the cached node reads are invalidated, not dropped,
      // so the selection keeps showing its node until the fresh one arrives,
      // and the trees invalidate optimistically (ALL_NODES keeps existing
      // rows until the refetch resolves).
      invalidateWorkspaceNodes(activeWorkspace?.name)
      signals.reportEdit([ALL_NODES])
      signals.reloadPreview()
    },
    // A collaborator's content edits (property/reference changes): swap the
    // affected elements in the preview out-of-band - the preview skips the
    // ones this page does not render - and refresh their tree rows (the trees
    // drop those nodes' cached reads). Of the shell's own reads only the
    // selected and the inspected node can be among them; those are refetched
    // here, whether or not a tree is open.
    remoteContentChanged: (aggregateIds: string[]) => {
      const baseAddress = selection.documentAddress ?? siteAddress
      if (!baseAddress) return
      const addresses = aggregateIds.map((nodeAggregateId) => ({
        ...nodeAddressOf(baseAddress),
        nodeAggregateId,
      }))
      for (const node of [selectedDocument, inspectedNode]) {
        if (node && aggregateIds.includes(node.nodeAggregateId)) {
          void queryClient.invalidateQueries({
            queryKey: neosKeys.nodes.node(nodeAddressOf(node)),
          })
        }
      }
      void invalidateAfterContentEdit(
        baseAddress.contentRepositoryId,
        baseAddress.workspaceName,
      )
      signals.reportEdit(addresses)
      signals.updatePreviewElements(addresses, true)
    },
    // A collaborator changed the structure (or published/discarded/rebased the
    // session): incremental updates cannot describe this - drop the shared
    // workspace's node reads and refresh wholesale.
    remoteWorkspaceChanged: () => {
      invalidateWorkspaceNodes(collaborativeWorkspace?.name)
      void invalidateWorkspaceQueries()
      refreshWorkspaceContent()
    },
  })

  const { lastEdit, previewReloadToken, previewElementUpdate } = signals
  const workspaceName = activeWorkspace?.name ?? null
  const personalWorkspaceName = personalWorkspace?.name ?? null
  const studioState = useMemo<StudioState>(
    () => ({
      site,
      workspaceName,
      personalWorkspaceName,
      dimensionSpacePoint,
      selectedDocument,
      inspectedNode,
      lastEdit,
      previewReloadToken,
      previewElementUpdate,
    }),
    [
      site,
      workspaceName,
      personalWorkspaceName,
      dimensionSpacePoint,
      selectedDocument,
      inspectedNode,
      lastEdit,
      previewReloadToken,
      previewElementUpdate,
    ],
  )

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
      <BootOverlay />
      <StudioProvider state={studioState} actions={actions}>
        <PresenceProvider value={presenceState}>
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
                      selection.documentAddress?.nodeAggregateId ?? null
                    }
                    focusedAggregateId={inspectedNode?.nodeAggregateId ?? null}
                    dimensionSpacePoint={dimensionSpacePoint}
                    editingElement={editingElement}
                    onPresence={setPresence}
                    onRemoteContentChange={handlers.remoteContentChanged}
                    onRemoteWorkspaceChange={handlers.remoteWorkspaceChanged}
                  />
                )}
                <Sidebar>
                  {/* Fixed to the main header's height (h-14, plus an
                    invisible border matching its border-b) so the row does
                    not shift when the avatar mounts after /me resolves. */}
                  <SidebarHeader className="h-12 shrink-0 justify-center border-b border-transparent">
                    <div className="flex items-center justify-between gap-2.5 px-2 pt-2">
                      <div className="flex items-center gap-1.5">
                        {/* The classic backend modules - hidden when
                          enableLegacyModules is disabled (see Settings.yaml). */}
                        <LegacyModulesMenu />
                        <NeosLogo />
                      </div>

                      <div className="flex items-center gap-1">
                        <NotificationBell />
                        <UserMenu />
                      </div>
                    </div>
                  </SidebarHeader>
                  <SidebarContent className="overflow-hidden p-1 pt-2">
                    <PanelDock region="sidebar" />
                  </SidebarContent>
                  <SidebarResizeHandle {...resizeHandleProps} />
                </Sidebar>

                <SidebarInset>
                  <ShellHeader
                    editing={editing}
                    document={selectedDocument}
                    onSelectSite={handlers.selectSite}
                    onChangeDimension={handlers.changeDimension}
                    onVariantCreated={handlers.variantCreated}
                    onReload={handlers.reload}
                    onSwitchEditingContext={handlers.switchEditingContext}
                    onNavigate={actions.navigateToNodeInWorkspace}
                  />

                  {/* The main area and the optional right-hand sidebar. The Visual
                  Editor (preview) and Media Library live here as panels; the
                  secondary dock belongs to the Visual Editor, so it only shows
                  while that is the active main tab - not for the Media Library. */}
                  <div className="flex min-h-0 flex-1">
                    <PanelDock region="main" />
                    <SecondaryDock visibleForMainPanel="visual-editor" />
                  </div>

                  {/* Blocking, undismissable: a role handed out mid-session
                    can leave the account writing into a workspace the content
                    repository now refuses. Better one dialog than a stream of
                    failed saves. */}
                  <WorkspaceLockoutDialog
                    access={access}
                    workspaces={editing.workspaces}
                    personalWorkspace={personalWorkspace}
                    activeWorkspace={activeWorkspace}
                    onSwitchEditingContext={handlers.switchEditingContext}
                  />
                </SidebarInset>
              </PanelsProvider>
            </AssetPickerProvider>
          </ModalProvider>
        </PresenceProvider>
      </StudioProvider>
    </SidebarProvider>
  )
}
