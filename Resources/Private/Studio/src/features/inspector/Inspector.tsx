import type { NodeDto } from '@/api/nodes'
import { nodeLabel } from '@/api/nodes'
import { useNodeTypes } from '@/api/nodeTypes'
import { Badge } from '@/components/ui/badge'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { NodeTypeIcon } from '@/features/tree/nodeTypeIcon'

/**
 * The inspector: a non-modal right-side drawer (the trees and the future
 * page preview in <main> stay interactive while it is open). Property
 * editors will replace the read-only summary; nested drawers (DrawerNested)
 * are available for secondary editors like media or reference pickers.
 */
export function Inspector({ node, onClose }: { node: NodeDto | null; onClose: () => void }) {
  const { data: nodeTypes } = useNodeTypes()

  return (
    <Drawer
      modal={false}
      // Clicks on the trees or the page preview must not dismiss the
      // inspector - only Escape, swipe or explicit close do.
      disablePointerDismissal
      open={node !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DrawerContent showOverlay={false}>
        {node && (
          <>
            <DrawerHeader>
              <DrawerTitle className="flex items-center gap-2">
                <NodeTypeIcon nodeTypes={nodeTypes} nodeTypeName={node.nodeType} />
                {nodeLabel(node)}
              </DrawerTitle>
              <DrawerDescription>{node.nodeType}</DrawerDescription>
            </DrawerHeader>
            <div className="space-y-4 overflow-y-auto px-4 pb-4 text-sm">
              <dl className="space-y-2">
                <InspectorRow label="Aggregate ID">
                  <span className="font-mono text-xs">{node.aggregateId}</span>
                </InspectorRow>
                <InspectorRow label="Workspace">{node.workspace}</InspectorRow>
                <InspectorRow label="Dimensions">
                  {Object.entries(node.dimensionSpacePoint)
                    .map(([dimension, value]) => `${dimension}: ${value}`)
                    .join(', ') || '–'}
                </InspectorRow>
                {node.tags.all.length > 0 && (
                  <InspectorRow label="Tags">
                    <span className="flex flex-wrap gap-1">
                      {node.tags.all.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </span>
                  </InspectorRow>
                )}
              </dl>
              <p className="text-xs text-muted-foreground">Property editors will live here.</p>
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}

function InspectorRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
