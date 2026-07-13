import { useMemo, useState } from 'react'
import type { NodeDto } from '@/api/nodes'
import { nodeLabel } from '@/api/nodes'
import { useNodeTypes, useNodeTypeSchema } from '@/api/nodeTypes'
import { Badge } from '@/components/ui/badge'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { persistPropertyChange } from '@/features/editing/persistProperty'
import { FaIcon, NodeTypeIcon } from '@/features/tree/nodeTypeIcon'
import { buildInspectorSchema, type InspectorGroup } from './inspectorSchema'
import { PropertyEditor } from './PropertyEditor'

/**
 * The inspector: a non-modal, floating right-side drawer (the trees and the
 * page preview in <main> stay interactive while it is open). The node type's
 * inspector configuration drives the structure - tabs containing groups
 * containing properties. Text properties are editable; other editors render
 * their value read-only until implemented. Nested drawers (DrawerNested) are
 * available for secondary editors like media or reference pickers.
 */
export function Inspector({
  node,
  onClose,
  onNodeEdited,
}: {
  node: NodeDto | null
  onClose: () => void
  /** A property edit for this address was persisted. */
  onNodeEdited?: (address: string) => void
}) {
  const { data: nodeTypes } = useNodeTypes()
  const { data: schema } = useNodeTypeSchema(node?.nodeType ?? null)
  const tabs = useMemo(() => (schema ? buildInspectorSchema(schema) : null), [schema])
  const [saveError, setSaveError] = useState<string | null>(null)

  const save = (propertyName: string, value: unknown) => {
    if (!node) return
    setSaveError(null)
    persistPropertyChange(node.address, propertyName, value)
      .then(() => onNodeEdited?.(node.address))
      .catch((e: unknown) => setSaveError(e instanceof Error ? e.message : String(e)))
  }

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
      {/* The inspector floats over the lower half of the viewport only, so
          the preview stays largely unobstructed. */}
      <DrawerContent showOverlay={false} className="mt-[50vh]">
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
              {saveError && <p className="text-xs text-destructive">Saving failed: {saveError}</p>}
              {tabs === null ? (
                <div className="space-y-2">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : tabs.length === 0 ? (
                <p className="text-xs text-muted-foreground">This node type has no inspector properties.</p>
              ) : (
                // Remount on node type change: the available tabs differ, and
                // the initially selected tab resets to the first one.
                <Tabs key={node.nodeType} defaultValue={tabs[0].id}>
                  <TabsList className="w-full">
                    {tabs.map((tab) => (
                      <TabsTrigger key={tab.id} value={tab.id} title={tab.label}>
                        {tab.icon && <FaIcon icon={tab.icon} />}
                        {tab.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {tabs.map((tab) => (
                    <TabsContent key={tab.id} value={tab.id} className="space-y-4">
                      {tab.groups.map((group) => (
                        <PropertyGroup key={group.id} group={group} node={node} onSave={save} />
                      ))}
                    </TabsContent>
                  ))}
                </Tabs>
              )}
              <Separator />
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
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}

function PropertyGroup({
  group,
  node,
  onSave,
}: {
  group: InspectorGroup
  node: NodeDto
  onSave: (propertyName: string, value: unknown) => void
}) {
  return (
    <details open={!group.collapsed} className="group/inspector-group">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
        {group.icon && <FaIcon icon={group.icon} />}
        {group.label}
        <span className="ml-auto transition-transform group-open/inspector-group:rotate-90">›</span>
      </summary>
      <div className="mt-2 space-y-3">
        {group.properties.map((property) => (
          <div key={property.name}>
            <label className="mb-1 block text-xs text-muted-foreground">{property.label}</label>
            <PropertyEditor
              // Reset drafts when the inspected node changes, keep them
              // across the refetch after a save.
              key={`${node.address}:${property.name}`}
              property={property}
              value={node.properties[property.name]}
              onSave={onSave}
            />
          </div>
        ))}
      </div>
    </details>
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
