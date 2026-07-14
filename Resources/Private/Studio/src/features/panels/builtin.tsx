import { fetchNode } from '@/api/nodes'
import { useStudio } from '@/app/StudioContext'
import { NodeCreationPanel } from '@/features/creation/NodeCreationPanel'
import type {
  NodeMenuAction,
  NodeMenuTarget,
} from '@/features/editing/NodeContextMenu'
import { InspectorPanel } from '@/features/inspector/Inspector'
import { ContentOutliner } from '@/features/tree/ContentOutliner'
import { DocumentTree } from '@/features/tree/DocumentTree'
import { clampToViewport, type PanelRect } from './geometry'
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
 * has to move somewhere that still exists).
 */
function reportNodeAction(
  nodeEdited: (address: string) => void,
  action: NodeMenuAction,
  target: NodeMenuTarget,
): void {
  if (action === 'delete') {
    if (target.parentAddress) nodeEdited(target.parentAddress)
  } else {
    nodeEdited(target.address)
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
    return (
      <div className="p-4 text-xs text-muted-foreground">Loading sites…</div>
    )
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
  panelRegistry.register({
    id: 'documents',
    title: 'Documents',
    component: DocumentsPanel,
    defaultPlacement: { kind: 'dock' },
  })
  panelRegistry.register({
    id: 'outline',
    title: 'Outline',
    component: OutlinePanel,
    defaultPlacement: { kind: 'dock' },
  })
  panelRegistry.register({
    id: 'create',
    title: 'Create',
    component: NodeCreationPanel,
    defaultPlacement: { kind: 'dock' },
  })
  panelRegistry.register({
    id: 'inspector',
    title: 'Inspector',
    component: NodeInspectorPanel,
    defaultPlacement: { kind: 'floating', rect: inspectorDefaultRect },
  })
}
