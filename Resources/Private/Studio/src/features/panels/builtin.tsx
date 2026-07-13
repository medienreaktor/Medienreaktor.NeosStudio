import { useStudio } from '@/app/StudioContext'
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

function DocumentsPanel() {
  const { site, workspaceName, selectedDocument, selectDocument } = useStudio()
  if (!site || !workspaceName) {
    return <div className="p-4 text-xs text-muted-foreground">Loading sites…</div>
  }
  return (
    <div className="p-2">
      {/* Remount per site so a site switch starts with fresh expansion state. */}
      <DocumentTree
        key={site.nodeAddress}
        site={site}
        workspaceName={workspaceName}
        selectedAddress={selectedDocument?.address ?? null}
        onSelect={selectDocument}
      />
    </div>
  )
}

function OutlinePanel() {
  const { selectedDocument, workspaceName, inspectedNode, lastEdit, inspectNode } = useStudio()
  return (
    <div className="p-2">
      <ContentOutliner
        document={selectedDocument}
        workspaceName={workspaceName}
        selectedAddress={inspectedNode?.address ?? null}
        lastEdit={lastEdit}
        onSelect={inspectNode}
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
    id: 'inspector',
    title: 'Inspector',
    component: NodeInspectorPanel,
    defaultPlacement: { kind: 'floating', rect: inspectorDefaultRect },
  })
}
