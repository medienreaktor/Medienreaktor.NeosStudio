import { useMemo, useRef, useState } from 'react'
import { dimensionSpacePointLabel, useDimensions } from '@/api/dimensions'
import type { NodeDto, SerializedPropertyValue } from '@/api/nodes'
import { isShineThrough, nodeLabel, useNodeAncestors } from '@/api/nodes'
import { useNodeTypes, useNodeTypeSchema } from '@/api/nodeTypes'
import { toast } from '@/components/ui/toast'
import { CollapsibleGroup } from '@/components/ui/collapsible-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Placeholder } from '@/components/ui/placeholder'
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
import {
  clientEvalNode,
  clientEvalUsesParentNode,
  deepEqual,
  evaluateInspectorTabs,
} from './clientEval'
import { buildInspectorSchema, type InspectorGroup } from './inspectorSchema'
import { PropertyEditor } from './PropertyEditor'
import { validateValue } from './validators'
import { InspectorViewRenderer } from './views/InspectorViewRenderer'

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
  /**
   * A property edit for this address was persisted. reload reflects the
   * property's configuration: 'page' (ui.reloadPageIfChanged), 'element'
   * (ui.reloadIfChanged - an out-of-band re-render of just this node's
   * element), or 'none' - the change does not affect the rendered page.
   */
  onNodeEdited?: (
    address: string,
    options?: { reload?: 'page' | 'element' | 'none' },
  ) => void
}) {
  const { data: nodeTypes } = useNodeTypes()
  const { data: schema } = useNodeTypeSchema(node?.nodeType ?? null)
  const tabs = useMemo(
    () => (schema ? buildInspectorSchema(schema) : null),
    [schema],
  )

  // Live, not-yet-committed editor input, overlaid on node.properties for
  // ClientEval - dependent fields react while the user types, like the
  // classic UI's transient values. Keyed by node address so switching the
  // inspected node discards them; after a commit the refetched node carries
  // the same values, so stale shadowing cannot occur.
  const [transient, setTransient] = useState<{
    address: string
    values: Record<string, unknown>
  } | null>(null)
  const transientValues =
    node && transient?.address === node.address ? transient.values : undefined
  const reportLiveChange = (propertyName: string, value: unknown) => {
    if (!node) return
    setTransient((previous) => ({
      address: node.address,
      values: {
        ...(previous?.address === node.address ? previous.values : undefined),
        [propertyName]: value,
      },
    }))
  }

  // The parent node is only fetched when an expression actually mentions
  // parentNode - most configurations never do.
  const needsParentNode = useMemo(() => clientEvalUsesParentNode(tabs), [tabs])
  const { data: ancestors } = useNodeAncestors(
    node?.address ?? null,
    needsParentNode,
  )
  const parentNode = ancestors?.[0] ?? null

  // Evaluate ClientEval against the current node state (persisted values plus
  // live edits): hides properties, resolves dynamic editor options. The deep
  // compare keeps the schema's identity stable when a re-evaluation changes
  // nothing, so editors do not re-render or refetch on every node refresh.
  const evaluatedTabs = useMemo(() => {
    if (!tabs || !node) return tabs
    return evaluateInspectorTabs(tabs, {
      node: clientEvalNode(node, transientValues),
      parentNode: parentNode ? clientEvalNode(parentNode) : null,
    })
  }, [tabs, node, transientValues, parentNode])
  const stableTabsRef = useRef(evaluatedTabs)
  if (!deepEqual(stableTabsRef.current, evaluatedTabs)) {
    stableTabsRef.current = evaluatedTabs
  }
  const visibleTabs = stableTabsRef.current

  // Validate every visible property's current value (persisted, overlaid with
  // live edits) - like the classic UI's validation of transient values, so
  // errors show while typing, not only after a failed save attempt. Hidden
  // properties are already dropped from visibleTabs and thus never block.
  const validationErrors = useMemo(() => {
    if (!visibleTabs || !node) return {}
    const errors: Record<string, string[]> = {}
    for (const property of visibleTabs
      .flatMap((tab) => tab.groups)
      .flatMap((group) => group.items)
      .flatMap((item) => (item.kind === 'property' ? [item.property] : []))) {
      if (Object.keys(property.validation).length === 0) continue
      const hasLiveValue =
        transientValues !== undefined && property.name in transientValues
      // Reference values do not live in node.properties (their editors fetch
      // them through the /references relation), so before any edit there is
      // nothing to validate against - a NotEmpty on a set reference would
      // falsely report empty. Validate references only once edited.
      if (
        (property.type === 'reference' || property.type === 'references') &&
        !hasLiveValue
      ) {
        continue
      }
      const value = hasLiveValue
        ? transientValues[property.name]
        : propertyValue(node, property.name)?.value
      const propertyErrors = validateValue(value, property.validation)
      if (propertyErrors.length > 0) errors[property.name] = propertyErrors
    }
    return errors
  }, [visibleTabs, node, transientValues])

  const save = (propertyName: string, value: unknown) => {
    if (!node) return
    // Reflect the commit in the ClientEval context right away - editors
    // without an editing phase (checkbox, select) never report live changes,
    // and dependent fields should not wait for the refetch roundtrip.
    reportLiveChange(propertyName, value)
    // Reference-typed "properties" are not node properties in Neos 9 - they
    // persist through SetNodeReferences (reference name = property name).
    const propertySchema = tabs
      ?.flatMap((tab) => tab.groups)
      .flatMap((group) => group.items)
      .flatMap((item) => (item.kind === 'property' ? [item.property] : []))
      .find((property) => property.name === propertyName)
    const propertyType = propertySchema?.type
    // An invalid value is never persisted: the commit is dropped and the
    // inline error (already visible - reportLiveChange above put the value
    // into the validation overlay) tells the user why. The editor keeps its
    // draft, so fixing the input and re-committing saves normally.
    if (
      propertySchema &&
      validateValue(value, propertySchema.validation).length > 0
    ) {
      return
    }
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
    // How the preview refreshes follows ui.reloadPageIfChanged ('page') /
    // ui.reloadIfChanged ('element': out-of-band re-render of just this
    // node's element) / neither ('none'). Two exceptions: a type change
    // always reloads the page, and _hidden never resolves to 'none' - the
    // Hidable mixin configures no reload flag (the classic UI dims hidden
    // elements client-side), but Studio's dimming attribute is server-
    // rendered, so content elements re-render out-of-band. Documents keep
    // the 'page' their Document-mixin reloadPageIfChanged resolves to (menus
    // change), as does any unknown property (not in the schema) - better one
    // reload than a stale preview.
    const reload =
      propertyName === NODE_TYPE_PROPERTY
        ? 'page'
        : propertyName === HIDDEN_PROPERTY
          ? propertySchema?.reload === 'page'
            ? 'page'
            : 'element'
          : (propertySchema?.reload ?? 'page')
    persist
      .then(() => onNodeEdited?.(node.address, { reload }))
      .catch((e: unknown) => toast.error(e, { title: 'Saving failed' }))
  }

  if (!node) {
    return (
      <Placeholder
        icon="fa-arrow-pointer"
        title="Select a node in the preview or the trees to inspect it."
      />
    )
  }

  return (
    <div className="text-sm">
      <div className="py-4 px-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <NodeTypeIcon nodeTypes={nodeTypes} nodeTypeName={node.nodeType} />
          {nodeLabel(node)}
        </h2>
        <ShineThroughNotice node={node} />
      </div>
      <div className="">
        {visibleTabs && (
          <>
            {visibleTabs.length === 0 ? (
              <p className="text-xs text-neutral-400">
                This node type has no inspector properties.
              </p>
            ) : (
              // Remount on node type change and when ClientEval changes the
              // set of visible tabs: the available tabs differ, and the
              // initially selected tab resets to the first one (also rescues
              // the selection when the selected tab was just hidden).
              <Tabs
                key={`${node.nodeType}:${visibleTabs.map((tab) => tab.id).join(',')}`}
                defaultValue={visibleTabs[0].id}
              >
                <TabsList>
                  {visibleTabs.map((tab) => {
                    // The classic UI's per-tab badge: how many of this tab's
                    // properties currently fail validation.
                    const errorCount = tab.groups
                      .flatMap((group) => group.items)
                      .filter(
                        (item) =>
                          item.kind === 'property' &&
                          validationErrors[item.property.name] !== undefined,
                      ).length
                    return (
                      <TabsTrigger
                        key={tab.id}
                        value={tab.id}
                        title={tab.label}
                      >
                        {tab.icon && <FaIcon icon={tab.icon} />}
                        {tab.label}
                        {errorCount > 0 && (
                          <span
                            className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[0.65rem] font-semibold text-white"
                            title={`${errorCount} validation ${errorCount === 1 ? 'error' : 'errors'}`}
                          >
                            {errorCount}
                          </span>
                        )}
                      </TabsTrigger>
                    )
                  })}
                </TabsList>
                {visibleTabs.map((tab) => (
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
                        validationErrors={validationErrors}
                        onSave={save}
                        onLiveChange={reportLiveChange}
                      />
                    ))}
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Alert under the inspector header for shine-through nodes: the node is only
 * visible because it falls back from another dimension. Names the origin
 * dimension so the editor knows where the content actually lives; an edit
 * (or the preview's "Create variant" button) materializes it here.
 */
function ShineThroughNotice({ node }: { node: NodeDto }) {
  const { data: dimensionsResponse } = useDimensions()
  if (!isShineThrough(node)) return null
  const origin = dimensionSpacePointLabel(
    node.originDimensionSpacePoint,
    dimensionsResponse?.dimensions ?? [],
  )
  return (
    <div
      role="status"
      className="mt-3 flex items-start gap-2 rounded-md border border-purple-500/60 bg-purple-900/60 p-2.5 text-xs text-purple-100"
    >
      <FaIcon icon="layer-group" className="mt-0.5 text-purple-300" />
      <p>
        Shines through from <strong className="text-white">{origin}</strong>.
        This node does not exist in the current dimension yet - editing it
        creates an independent variant here.
      </p>
    </div>
  )
}

function PropertyGroup({
  group,
  node,
  validationErrors,
  onSave,
  onLiveChange,
}: {
  group: InspectorGroup
  node: NodeDto
  /** Property name -> errors for the property's current (live) value. */
  validationErrors: Record<string, string[]>
  onSave: (propertyName: string, value: unknown) => void
  /** A keystroke-level (pre-commit) value change - feeds ClientEval. */
  onLiveChange: (propertyName: string, value: unknown) => void
}) {
  return (
    <CollapsibleGroup
      defaultOpen={!group.collapsed}
      className="border-b border-neutral-700 p-2"
      label={
        <>
          {group.icon && <FaIcon icon={group.icon} />}
          {group.label}
        </>
      }
      bodyClassName="space-y-4"
    >
      {group.items.map((item) =>
        item.kind === 'property' ? (
          <div key={item.property.name}>
            <PropertyEditor
              // Reset drafts when the inspected node changes, keep them
              // across the refetch after a save.
              key={`${node.address}:${item.property.name}`}
              property={item.property}
              value={propertyValue(node, item.property.name)}
              nodeAddress={node.address}
              errors={validationErrors[item.property.name]}
              onSave={onSave}
              onLiveChange={onLiveChange}
            />
          </div>
        ) : (
          <div key={item.view.name}>
            <InspectorViewRenderer view={item.view} node={node} />
          </div>
        ),
      )}
    </CollapsibleGroup>
  )
}
