import { useMemo, useState } from 'react'
import type { NodeDto } from '@/api/nodes'
import { nodeLabel } from '@/api/nodes'
import { useNodeTypes, useNodeTypeSchema } from '@/api/nodeTypes'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { persistPropertyChange } from '@/features/editing/persistProperty'
import { FaIcon, NodeTypeIcon } from '@/features/tree/nodeTypeIcon'
import { buildInspectorSchema, type InspectorGroup } from './inspectorSchema'
import { PropertyEditor } from './PropertyEditor'

/**
 * The inspector panel's content (the panel chrome - tab, dragging, floating -
 * comes from the panel system). The node type's inspector configuration
 * drives the structure: tabs containing groups containing properties. Text
 * properties are editable; other editors render their value read-only until
 * implemented.
 */
export function InspectorPanel({
  node,
  onNodeEdited,
}: {
  node: NodeDto | null
  /** A property edit for this address was persisted. */
  onNodeEdited?: (address: string) => void
}) {
  const { data: nodeTypes } = useNodeTypes()
  const { data: schema } = useNodeTypeSchema(node?.nodeType ?? null)
  const tabs = useMemo(
    () => (schema ? buildInspectorSchema(schema) : null),
    [schema],
  )
  const [saveError, setSaveError] = useState<string | null>(null)

  const save = (propertyName: string, value: unknown) => {
    if (!node) return
    setSaveError(null)
    persistPropertyChange(node.address, propertyName, value)
      .then(() => onNodeEdited?.(node.address))
      .catch((e: unknown) =>
        setSaveError(e instanceof Error ? e.message : String(e)),
      )
  }

  if (!node) {
    return (
      <p className="p-4 text-xs text-muted-foreground">
        Select a node in the preview or the trees to inspect it.
      </p>
    )
  }

  return (
    <div className="text-sm">
      <div className="py-4 px-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <NodeTypeIcon nodeTypes={nodeTypes} nodeTypeName={node.nodeType} />
          {nodeLabel(node)}
        </h2>
      </div>
      <div className="">
        {saveError && (
          <p className="text-xs text-destructive">Saving failed: {saveError}</p>
        )}
        {tabs && (
          <>
            {tabs.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                This node type has no inspector properties.
              </p>
            ) : (
              // Remount on node type change: the available tabs differ, and
              // the initially selected tab resets to the first one.
              <Tabs key={node.nodeType} defaultValue={tabs[0].id}>
                <TabsList>
                  {tabs.map((tab) => (
                    <TabsTrigger key={tab.id} value={tab.id} title={tab.label}>
                      {tab.icon && <FaIcon icon={tab.icon} />}
                      {tab.label}
                    </TabsTrigger>
                  ))}
                  <TabsTrigger
                    key={'__nodeData'}
                    value={'__nodeData'}
                    title="Node Data"
                  >
                    <FaIcon icon={'database'} />
                  </TabsTrigger>
                </TabsList>
                {tabs.map((tab) => (
                  <TabsContent
                    key={tab.id}
                    value={tab.id}
                    className="space-y-4 py-2"
                  >
                    {tab.groups.map((group) => (
                      <PropertyGroup
                        key={group.id}
                        group={group}
                        node={node}
                        onSave={save}
                      />
                    ))}
                  </TabsContent>
                ))}
                <TabsContent
                  key={'__nodeData'}
                  value={'__nodeData'}
                  className="space-y-4 py-2"
                >
                  <dl className="space-y-2">
                    <InspectorRow label="Node Type">
                      {node.nodeType}
                    </InspectorRow>
                    <InspectorRow label="Aggregate ID">
                      <span className="font-mono text-xs">
                        {node.aggregateId}
                      </span>
                    </InspectorRow>
                    <InspectorRow label="Workspace">
                      {node.workspace}
                    </InspectorRow>
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
                </TabsContent>
              </Tabs>
            )}
          </>
        )}
      </div>
    </div>
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
        <span className="ml-auto transition-transform group-open/inspector-group:rotate-90">
          ›
        </span>
      </summary>
      <div className="mt-2 space-y-3">
        {group.properties.map((property) => (
          <div key={property.name}>
            <label className="mb-1 block text-xs text-muted-foreground">
              {property.label}
            </label>
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

function InspectorRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  )
}
