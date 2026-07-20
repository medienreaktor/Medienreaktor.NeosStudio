import { useEffect, useState } from 'react'
import { fetchNode } from '@/api/nodes'
import { useStudio } from '@/app/StudioContext'
import {
  InsertNodeDialog,
  type InsertRequest,
} from '@/features/creation/InsertNodeDialog'
import { NodeCreationPanel } from '@/features/creation/NodeCreationPanel'
import type {
  NodeMenuAction,
  NodeMenuTarget,
} from '@/features/editing/NodeContextMenu'
import { InspectorPanel } from '@/features/inspector/Inspector'
import { useAssetPicker } from '@/features/media/AssetPicker'
import { MediaBrowser } from '@/features/media/MediaBrowser'
import { PreviewPane } from '@/features/preview/PreviewPane'
import { ContentOutliner } from '@/features/tree/ContentOutliner'
import { DocumentSearchList } from '@/features/tree/DocumentSearchList'
import { DocumentsToolbar } from '@/features/tree/DocumentsToolbar'
import { DocumentTree } from '@/features/tree/DocumentTree'
import { LoadingState } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { clampToViewport, type PanelRect } from './geometry'
import { useRequestAttention } from './PanelSystem'
import { panelRegistry } from './registry'

/**
 * The built-in panels, registered exactly like a third-party panel would be:
 * a propless component reading app state via useStudio(), wrapped around the
 * reusable feature component.
 */

/**
 * Shared refresh semantics after a tree context-menu action: hide/unhide
 * report the node itself (its decor and inspector snapshot refresh), a
 * delete reports the parent (its children list shrinks and the inspection
 * has to move somewhere that still exists). Hide/unhide ask for an
 * element-level preview refresh: content elements re-render out-of-band,
 * and nodes without a rendered element on the page (documents - whose
 * hiding changes menus, or content of another document) fall back to the
 * full reload automatically.
 */
function reportNodeAction(
  nodeEdited: (
    address: string,
    options?: { reload?: 'page' | 'element' | 'none' },
  ) => void,
  action: NodeMenuAction,
  target: NodeMenuTarget,
): void {
  if (action === 'delete') {
    if (target.parentAddress) nodeEdited(target.parentAddress)
  } else {
    nodeEdited(target.address, { reload: 'element' })
  }
}

function DocumentsPanel() {
  const {
    site,
    workspaceName,
    selectedDocument,
    selectDocument,
    lastEdit,
    nodeEdited,
    nodesEdited,
  } = useStudio()
  const [insertRequest, setInsertRequest] = useState<InsertRequest | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedTerm, setDebouncedTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState<string[]>([])
  // The reference pickers' search cadence: 300 ms debounce before the fetch.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(searchTerm.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchTerm])
  if (!site || !workspaceName) {
    return <LoadingState label="Loading sites…" />
  }
  // A term or an active node type filter switches from the tree to the flat
  // server-side result list (all matching documents, regardless of depth).
  const filtering = debouncedTerm !== '' || typeFilter.length > 0
  return (
    <div className="flex min-h-full flex-col">
      <DocumentsToolbar
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        createDisabled={!selectedDocument}
        onCreate={() =>
          selectedDocument &&
          setInsertRequest({
            referenceAddress: selectedDocument.address,
            // The site node must not get siblings (that would be a new
            // site); any other document's parent resolves in the dialog.
            parentAddress:
              selectedDocument.address === site.nodeAddress ? null : undefined,
            defaultMode: 'inside',
          })
        }
      />
      <div className="flex min-h-0 flex-1 flex-col p-2">
        {filtering && (
          <DocumentSearchList
            site={site}
            workspaceName={workspaceName}
            term={debouncedTerm}
            nodeTypeFilter={typeFilter}
            selectedAddress={selectedDocument?.address ?? null}
            onSelect={selectDocument}
          />
        )}
        {/* Remount per site so a site switch starts with fresh expansion
            state; kept mounted (hidden) while filtering so clearing the
            search returns to the tree exactly as it was left. */}
        <div
          className={cn('flex min-h-0 flex-1 flex-col', filtering && 'hidden')}
        >
          <DocumentTree
            key={site.nodeAddress}
            site={site}
            workspaceName={workspaceName}
            selectedAddress={selectedDocument?.address ?? null}
            lastEdit={lastEdit}
            onSelect={selectDocument}
            onMoved={nodesEdited}
            onCreateNew={(target) =>
              setInsertRequest({
                referenceAddress: target.address,
                parentAddress: target.parentAddress,
                defaultMode: 'inside',
              })
            }
            onNodeAction={(action, target) => {
              reportNodeAction(nodeEdited, action, target)
              // The deleted document cannot stay selected - browse its parent.
              if (
                action === 'delete' &&
                target.parentAddress &&
                selectedDocument?.address === target.address
              ) {
                fetchNode(target.parentAddress)
                  .then(selectDocument)
                  .catch(() => {
                    /* fine - the tree simply keeps the stale selection */
                  })
              }
            }}
          />
        </div>
      </div>
      <InsertNodeDialog
        request={insertRequest}
        role="document"
        onCreated={(address, creation) => {
          setInsertRequest(null)
          // Refresh the insertion parent's children (the tree row) and the
          // preview, then browse to the new document.
          nodesEdited([creation.parentAddress])
          fetchNode(address)
            .then(selectDocument)
            .catch(() => {
              /* fine - the tree refresh alone shows the new document */
            })
        }}
        onClose={() => setInsertRequest(null)}
      />
    </div>
  )
}

function OutlinePanel() {
  const {
    selectedDocument,
    workspaceName,
    inspectedNode,
    lastEdit,
    inspectNode,
    nodeEdited,
    nodesEdited,
  } = useStudio()
  const [insertRequest, setInsertRequest] = useState<InsertRequest | null>(null)
  return (
    <div className="p-2">
      <ContentOutliner
        document={selectedDocument}
        workspaceName={workspaceName}
        selectedAddress={inspectedNode?.address ?? null}
        lastEdit={lastEdit}
        onSelect={inspectNode}
        onMoved={nodesEdited}
        onCreateNew={(target) =>
          setInsertRequest({
            referenceAddress: target.address,
            parentAddress: target.parentAddress,
            defaultMode: 'after',
          })
        }
        onNodeAction={(action, target) =>
          reportNodeAction(nodeEdited, action, target)
        }
      />
      <InsertNodeDialog
        request={insertRequest}
        role="content"
        onCreated={(address, creation) => {
          setInsertRequest(null)
          // Refresh the collection's children and reload the preview, then
          // inspect the new element (revealing it in outliner and preview).
          nodesEdited([creation.parentAddress])
          fetchNode(address)
            .then(inspectNode)
            .catch(() => {
              /* fine - the outliner refresh alone shows the new element */
            })
        }}
        onClose={() => setInsertRequest(null)}
      />
    </div>
  )
}

function NodeInspectorPanel() {
  const { inspectedNode, nodeEdited } = useStudio()
  return <InspectorPanel node={inspectedNode} onNodeEdited={nodeEdited} />
}

/**
 * The Visual Editor: the page preview with in-place editing. All of its wiring
 * (selected document, reload token, selection/navigation
 * callbacks) comes from the studio context, so the panel is self-contained.
 * The preview toolbar itself stays in the app header.
 */
function VisualEditorPanel() {
  const {
    selectedDocument,
    previewReloadToken,
    previewElementUpdate,
    inspectedNode,
    inspectAddress,
    navigateToNode,
    reportInlineEdit,
  } = useStudio()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PreviewPane
        document={selectedDocument}
        selectedAddress={inspectedNode?.address ?? null}
        onSelectNode={inspectAddress}
        onNavigateToNode={navigateToNode}
        onNodeEdited={(address) =>
          reportInlineEdit(Array.isArray(address) ? address : [address])
        }
        reloadToken={previewReloadToken}
        elementUpdate={previewElementUpdate}
      />
    </div>
  )
}

/**
 * The Media Library: the reusable asset browser. Normally its full manage
 * module; while an inspector editor has an asset pick in flight (see
 * AssetPicker) it flips to picker mode, so double-clicking an asset hands it
 * back to the editor instead of opening its metadata dialog.
 */
function MediaLibraryPanel() {
  const { session, resolve, cancel } = useAssetPicker()
  // While a pick is in flight the Media Library has taken over a task the user
  // must finish, so it asks the panel system to spotlight it (blue ring/tab,
  // other panels dimmed).
  useRequestAttention(session !== null)
  if (session) {
    return (
      <MediaBrowser
        mode="picker"
        onPick={resolve}
        onCancel={cancel}
        pickerTitle={session.title}
      />
    )
  }
  return <MediaBrowser mode="manage" />
}

/** Where the inspector historically sat: right edge, lower half. */
function inspectorDefaultRect(): PanelRect {
  return clampToViewport({
    width: 384,
    height: Math.round(window.innerHeight / 2) - 16,
    x: window.innerWidth - 384 - 16,
    y: Math.round(window.innerHeight / 2) + 8,
  })
}

/** Call once before the app mounts. */
export function registerBuiltinPanels(): void {
  // The Visual Editor registers first so it is the default-active tab in the
  // main area, with Media Library alongside it.
  panelRegistry.register({
    id: 'visual-editor',
    title: 'Visual Editor',
    component: VisualEditorPanel,
    defaultPlacement: { kind: 'dock', region: 'main' },
  })
  panelRegistry.register({
    id: 'media-library',
    title: 'Media Library',
    component: MediaLibraryPanel,
    defaultPlacement: { kind: 'dock', region: 'main' },
  })
  panelRegistry.register({
    id: 'documents',
    title: 'Documents',
    component: DocumentsPanel,
    defaultPlacement: { kind: 'dock', region: 'sidebar' },
  })
  panelRegistry.register({
    id: 'outline',
    title: 'Outline',
    component: OutlinePanel,
    defaultPlacement: { kind: 'dock', region: 'sidebar' },
  })
  panelRegistry.register({
    id: 'create',
    title: 'Create',
    component: NodeCreationPanel,
    defaultPlacement: { kind: 'dock', region: 'sidebar' },
  })
  panelRegistry.register({
    id: 'inspector',
    title: 'Inspector',
    component: NodeInspectorPanel,
    defaultPlacement: { kind: 'floating', rect: inspectorDefaultRect },
  })
}
