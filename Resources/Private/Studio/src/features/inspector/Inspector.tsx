import { useMemo, useRef, useState } from 'react'
import { dimensionSpacePointLabel, useDimensions } from '@/api/dimensions'
import type { NodeDto, SerializedPropertyValue } from '@/api/nodes'
import {
  DOCUMENT_NODE_TYPE,
  isDeleted,
  isShineThrough,
  nodeLabel,
  useNodeAncestors,
} from '@/api/nodes'
import { isOfType, useNodeTypes, useNodeTypeSchema } from '@/api/nodeTypes'
import { toast } from '@/components/ui/toast'
import { CollapsibleGroup } from '@/components/ui/collapsible-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Placeholder } from '@/components/ui/placeholder'
import {
  changeNodeType,
  hideNodes,
  unhideNodes,
} from '@/features/editing/nodeActions'
import {
  persistPropertyChange,
  persistReferenceChange,
} from '@/features/editing/persistProperty'
import { aggregateIdOf } from '@/api/nodeAddress'
import { useNodeEditable } from '@/features/access/useAccess'
import { usePresence } from '@/features/collaboration/PresenceContext'
import { FaIcon, NodeTypeIcon } from '@/features/tree/nodeTypeIcon'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
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
  // Pages outside the account's access roles are shown, not edited - the
  // content repository would refuse the save anyway, and finding that out
  // after typing a paragraph is the worst possible moment to learn it.
  const editable = useNodeEditable(node)
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

  // The tab the user picked. Deliberately NOT implemented by remounting the
  // Tabs on visibility changes: a ClientEval edit can change the visible
  // property set mid-commit (assigning an image reveals its dependent
  // fields), and a remount would destroy every editor's in-flight state -
  // the freshly picked image would re-seed from the not-yet-refetched node
  // and visibly vanish. Instead the selection is controlled, and the render
  // below falls back to the first tab whenever the picked one is not
  // currently visible (hidden by ClientEval, or gone with a type change).
  const [selectedTab, setSelectedTab] = useState<string | null>(null)

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
    // The editors are inert while locked, so this cannot normally fire -
    // it is here so no future surface can route a write around the lock.
    if (!editable) return
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
          ? hideNodes([node.address])
          : unhideNodes([node.address])
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
    // rendered, so content elements re-render out-of-band. An unknown
    // property (not in the schema) reloads the page - better one reload
    // than a stale preview.
    const configuredReload =
      propertyName === NODE_TYPE_PROPERTY
        ? 'page'
        : propertyName === HIDDEN_PROPERTY
          ? propertySchema?.reload === 'page'
            ? 'page'
            : 'element'
          : (propertySchema?.reload ?? 'page')
    // Documents never take the element path: a document is not rendered as a
    // swappable element (no metadata wrapper in the markup), so the classic
    // UI reloads the guest frame for document-level reloadIfChanged - and so
    // does Studio. Going through the out-of-band machinery would only add a
    // guest roundtrip that ends in the same reload, with its timeout as a
    // failure mode. Unknown node types (map not loaded yet) count as
    // documents - a page reload is always correct, just not minimal.
    const isDocument =
      nodeTypes === undefined ||
      isOfType(nodeTypes, node.nodeType, DOCUMENT_NODE_TYPE)
    const reload =
      configuredReload === 'element' && isDocument ? 'page' : configuredReload
    persist
      .then(() => onNodeEdited?.(node.address, { reload }))
      .catch((e: unknown) =>
        toast.error(e, { title: t('inspector.savingFailed', 'Saving failed') }),
      )
  }

  if (!node) {
    return (
      <Placeholder
        icon="fa-arrow-pointer"
        title={t(
          'inspector.selectNodeHint',
          'Select a node in the preview or the trees to inspect it.',
        )}
      />
    )
  }

  // A deleted node (opened from the trash) is shown, not edited: its editors
  // would persist changes onto something that is on its way out, and the
  // reference editors cannot even read their targets - deleted nodes are
  // invisible to every read that does not deliberately ask for them.
  if (isDeleted(node)) {
    return (
      <div className="text-sm">
        <div className="px-3 py-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <NodeTypeIcon nodeTypes={nodeTypes} nodeTypeName={node.nodeType} />
            {nodeLabel(node)}
          </h2>
        </div>
        <Placeholder
          icon="fa-trash-can"
          title={t(
            'inspector.nodeDeleted',
            'This node is deleted. Restore it to edit its properties again.',
          )}
        />
      </div>
    )
  }

  return (
    <div className="text-sm">
      <div className="py-4 px-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <NodeTypeIcon nodeTypes={nodeTypes} nodeTypeName={node.nodeType} />
          {nodeLabel(node)}
        </h2>
        <ShineThroughNotice node={node} />
        <ElementLockNotice node={node} />
        {!editable && <AccessLockNotice />}
      </div>
      {/* inert, not just dimmed: it takes the whole subtree out of the tab
          order and swallows every event, so a locked editor cannot be reached
          by keyboard either - which pointer-events-none would not manage. */}
      <div inert={!editable} className={cn(!editable && 'opacity-60')}>
        {visibleTabs && (
          <>
            {visibleTabs.length === 0 ? (
              <p className="text-xs text-neutral-600 dark:text-neutral-400">
                {t(
                  'inspector.noProperties',
                  'This node type has no inspector properties.',
                )}
              </p>
            ) : (
              // Controlled selection, falling back to the first tab when the
              // picked one is not among the visible ones - never a remount,
              // so the property editors (and their in-flight drafts) survive
              // ClientEval visibility changes and node switches.
              <Tabs
                value={
                  visibleTabs.some((tab) => tab.id === selectedTab)
                    ? selectedTab
                    : visibleTabs[0].id
                }
                onValueChange={(value) => setSelectedTab(value as string)}
              >
                {/* Wrapping, not scrolling: the inspector panel is narrow and
                    resizable, and a horizontal scroller parks tabs behind an
                    edge with nothing on screen to hint that they are there. */}
                <TabsList className="h-auto w-full flex-wrap overflow-x-visible">
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
                    // Icon alone, like the classic Neos inspector: labelling
                    // five or six tabs does not fit a 320px panel. Every tab
                    // is the same width that way, so the wrapped list keeps
                    // its shape as the selection moves. A tab configured
                    // without an icon has nothing else to go by and keeps its
                    // label.
                    const labelled = !tab.icon
                    return (
                      <TabsTrigger
                        key={tab.id}
                        value={tab.id}
                        title={tab.label}
                        // The triggers carry their own size now that the
                        // wrapping list has no fixed height. h-9/min-w-9 is
                        // the same footprint the icon button and the toggle
                        // use for an icon-only control; min-w rather than a
                        // square so a tab showing an error badge can grow.
                        className="h-9 min-w-9 flex-none px-2"
                      >
                        {tab.icon && <FaIcon icon={tab.icon} />}
                        {/* Hidden, never dropped: the title attribute is not
                            an accessible name every screen reader announces,
                            so the label stays in the tree either way. */}
                        <span className={cn(!labelled && 'sr-only')}>
                          {tab.label}
                        </span>
                        {errorCount > 0 && (
                          <span
                            className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[0.65rem] font-semibold text-white"
                            title={
                              errorCount === 1
                                ? t(
                                    'inspector.validationError',
                                    '{0} validation error',
                                    [errorCount],
                                  )
                                : t(
                                    'inspector.validationErrors',
                                    '{0} validation errors',
                                    [errorCount],
                                  )
                            }
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
      className="mt-3 flex items-start gap-2 rounded-md border border-purple-500/60 bg-purple-100/60 dark:bg-purple-900/60 p-2.5 text-xs text-purple-900 dark:text-purple-100"
    >
      <FaIcon
        icon="layer-group"
        className="mt-0.5 text-purple-700 dark:text-purple-300"
      />
      <p>
        {t('inspector.shineThroughFrom', 'Shines through from')}{' '}
        <strong className="text-neutral-950 dark:text-white">{origin}</strong>.{' '}
        {t(
          'inspector.shineThroughHint',
          'This node does not exist in the current dimension yet - editing it creates an independent variant here.',
        )}
      </p>
    </div>
  )
}

/**
 * Alert under the inspector header while a collaborator holds the edit lock
 * on this element (they have it selected in a realtime session). Advisory,
 * like the preview's lock rendering: locks are a Studio/sidecar concept and
 * deliberately not enforced by the API.
 */
/**
 * Why the editors are inert: this page is not inside the access role the
 * account works under. Deliberately says who to ask rather than only what is
 * forbidden - the editor cannot lift this themselves.
 */
function AccessLockNotice() {
  return (
    <div
      role="status"
      className="mt-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <i className="fas fa-lock mt-0.5" aria-hidden />
      <p>
        {t(
          'inspector.accessLockedHint',
          'This page is outside your access role — you can read it, but not change it. An administrator can widen the role.',
        )}
      </p>
    </div>
  )
}

function ElementLockNotice({ node }: { node: NodeDto }) {
  const { peers } = usePresence()
  const holder = peers.find(
    (peer) =>
      peer.editingElement !== null &&
      peer.editingElement.nodeAggregateId === aggregateIdOf(node.address),
  )
  if (!holder) return null
  return (
    <div
      role="status"
      className="mt-3 flex items-start gap-2 rounded-md border p-2.5 text-xs"
      style={{ borderColor: holder.color }}
    >
      <i className="fas fa-pen mt-0.5" style={{ color: holder.color }} />
      <p>
        <strong className="text-neutral-950 dark:text-white">
          {holder.name}
        </strong>{' '}
        {t(
          'inspector.elementLockedHint',
          'is editing this element right now - it is locked until they are done.',
        )}
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
      className="border-b border-neutral-300 dark:border-neutral-700 p-3"
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
