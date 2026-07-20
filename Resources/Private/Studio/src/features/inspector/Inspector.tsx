import { useMemo } from 'react'
import type { NodeDto, SerializedPropertyValue } from '@/api/nodes'
import { nodeLabel } from '@/api/nodes'
import { useNodeTypes, useNodeTypeSchema } from '@/api/nodeTypes'
import { toast } from '@/components/ui/toast'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  changeNodeType,
  hideNode,
  unhideNode,
} from '@/features/editing/nodeActions'
import {
  persistPropertyChange,
  persistReferenceChange,
} from '@/features/editing/persistProperty'
import { FaIcon, NodeTypeIcon } from '@/features/tree/nodeTypeIcon'
import { buildInspectorSchema, type InspectorGroup } from './inspectorSchema'
import { PropertyEditor } from './PropertyEditor'

/**
 * The visibility flag from the Neos.Neos:Hidable mixin. Configured as a
 * boolean property, but in Neos 9 it is not a real content-repository property
 * - it is the "disabled" subtree tag. So its value comes from the node's tags,
 * and toggling it goes through the enable/disable commands rather than
 * SetNodeProperties (see the save routing below). hiddenInMenu, by contrast,
 * is an ordinary boolean property and takes the normal property path.
 */
const HIDDEN_PROPERTY = '_hidden'

/**
 * The node type, exposed by Neos core as the "_nodeType" inspector property
 * (the "Change Type" group, NodeTypeEditor). Like _hidden it is not a real
 * content-repository property: its value is the node's type, and changing it is
 * a ChangeNodeAggregateType command, so it is special-cased below rather than
 * written with SetNodeProperties.
 */
const NODE_TYPE_PROPERTY = '_nodeType'

/**
 * Normalize a reference editor's committed value to the target id list the
 * SetNodeReferences transport expects: single editors commit a string or null,
 * multi editors an array; empty means "clear the reference".
 */
function referenceTargets(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v !== '')
  }
  return typeof value === 'string' && value !== '' ? [value] : []
}

/**
 * The value to feed a property's editor. Ordinary properties read straight from
 * node.properties; _hidden and _nodeType are pseudo-properties synthesized from
 * the node's tags and type, since they have no property value of their own.
 */
function propertyValue(
  node: NodeDto,
  name: string,
): SerializedPropertyValue | undefined {
  if (name === HIDDEN_PROPERTY) {
    return { value: node.tags.all.includes('disabled'), type: 'boolean' }
  }
  if (name === NODE_TYPE_PROPERTY) {
    return { value: node.nodeType, type: 'string' }
  }
  return node.properties[name]
}

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
  const save = (propertyName: string, value: unknown) => {
    if (!node) return
    // Reference-typed "properties" are not node properties in Neos 9 - they
    // persist through SetNodeReferences (reference name = property name).
    const propertyType = tabs
      ?.flatMap((tab) => tab.groups)
      .flatMap((group) => group.properties)
      .find((property) => property.name === propertyName)?.type
    // Two further "properties" are not real properties and route to their own
    // commands: _hidden is the "disabled" subtree tag (enable/disable, like the
    // tree/preview hide actions), and the node type is changed with
    // ChangeNodeAggregateType.
    const persist =
      propertyName === HIDDEN_PROPERTY
        ? value === true
          ? hideNode(node.address)
          : unhideNode(node.address)
        : propertyName === NODE_TYPE_PROPERTY
          ? changeNodeType(node.address, String(value))
          : propertyType === 'reference' || propertyType === 'references'
            ? persistReferenceChange(
                node.address,
                propertyName,
                referenceTargets(value),
              )
            : persistPropertyChange(node.address, propertyName, value)
    persist
      .then(() => onNodeEdited?.(node.address))
      .catch((e: unknown) => toast.error(e, { title: 'Saving failed' }))
  }

  if (!node) {
    return (
      <p className="p-4 text-xs text-neutral-400">
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
        {tabs && (
          <>
            {tabs.length === 0 ? (
              <p className="text-xs text-neutral-400">
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
                    className="space-y-4"
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
                  className="space-y-4"
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
    <details
      open={!group.collapsed}
      className="group/inspector-group border-b border-neutral-700 p-2 m-0"
    >
      <summary className="flex py-2 cursor-pointer list-none items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-white select-none [&::-webkit-details-marker]:hidden">
        {group.icon && <FaIcon icon={group.icon} />}
        {group.label}
        <span className="ml-auto transition-transform group-open/inspector-group:rotate-90">
          <FaIcon icon="chevron-right" />
        </span>
      </summary>
      <div className="py-2 space-y-4">
        {group.properties.map((property) => (
          <div key={property.name}>
            <PropertyEditor
              // Reset drafts when the inspected node changes, keep them
              // across the refetch after a save.
              key={`${node.address}:${property.name}`}
              property={property}
              value={propertyValue(node, property.name)}
              nodeAddress={node.address}
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
      <dt className="text-xs uppercase tracking-wide text-neutral-400">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  )
}
