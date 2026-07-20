import { fetchNode } from '@/api/nodes'
import { useStudio } from '@/app/StudioContext'
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
import { DocumentTree } from '@/features/tree/DocumentTree'
import { LoadingState } from '@/components/ui/spinner'
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
  if (!site || !workspaceName) {
    return <LoadingState label="Loading sites…" />
  }
  return (
    <div className="p-2">
      {/* Remount per site so a site switch starts with fresh expansion state. */}
      <DocumentTree
        key={site.nodeAddress}
        site={site}
        workspaceName={workspaceName}
        selectedAddress={selectedDocument?.address ?? null}
        lastEdit={lastEdit}
        onSelect={selectDocument}
        onMoved={nodesEdited}
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
  return (
    <div className="p-2">
      <ContentOutliner
        document={selectedDocument}
        workspaceName={workspaceName}
        selectedAddress={inspectedNode?.address ?? null}
        lastEdit={lastEdit}
        onSelect={inspectNode}
        onMoved={nodesEdited}
        onNodeAction={(action, target) =>
          reportNodeAction(nodeEdited, action, target)
        }
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
