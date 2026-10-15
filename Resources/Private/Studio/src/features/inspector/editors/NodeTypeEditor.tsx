import { Fragment, useMemo } from 'react'
import {
  useAllowedChildNodeTypes,
  useNode,
  useNodeAncestors,
} from '@/api/neos/endpoints/nodes'
import {
  configuredLabel,
  useNodeTypeGroups,
  useNodeTypes,
} from '@/api/neos/endpoints/nodeTypes'
import { nodeAddressOf, type NodeType } from '@/api/neos/schema'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { humanizeLabel } from '@/features/inspector/inspectorSchema'
import { NodeTypeIcon } from '@/features/tree/nodeTypeIcon'
import { sortByPosition } from '@/lib/positional'
import type { PropertyEditorComponent } from './registry'

export const NODE_TYPE_EDITOR = 'Neos.Neos/Inspector/Editors/NodeTypeEditor'

const typeLabel = (nodeType: NodeType): string =>
  humanizeLabel(
    configuredLabel(nodeType),
    nodeType.name.split(':').pop() ?? nodeType.name,
  )

/**
 * Switches a node's type. The alternatives offered are the node types allowed
 * at the node's position - i.e. the ones its parent accepts as children
 * (server-computed, honoring tethered-collection constraints), narrowed to
 * concrete types. They are grouped and ordered like the node creation panel:
 * by the node type group definitions (Neos.Neos.nodeTypes.groups) and
 * ui.position within each group. Picking one commits the new type name; the
 * host runs the ChangeNodeAggregateType command (see the inspector's Node
 * Data tab).
 *
 * Inspector-only: it needs the node's address to resolve the parent, so
 * without one (e.g. in a creation dialog) it degrades to a read-only type
 * name - as it also does for tethered and root nodes (their type is fixed)
 * and when the position offers no real alternative.
 */
export const NodeTypeEditor: PropertyEditorComponent = ({
  value,
  onCommit,
  nodeAddress,
}) => {
  const { data: nodeTypes } = useNodeTypes()
  const { data: groupList } = useNodeTypeGroups()
  const groupConfigs = useMemo(
    () => new Map((groupList ?? []).map((group) => [group.name, group])),
    [groupList],
  )
  const currentType = typeof value === 'string' ? value : ''

  // Tethered (auto-created) and root nodes are structural - their type is fixed
  // even though _nodeType still appears on them. Read from cache (the inspector
  // already fetched this node).
  const { data: self } = useNode(nodeAddress ?? null)
  const fixedType =
    self?.classification === 'tethered' || self?.classification === 'root'

  // What the parent allows below it - the same cached read (keyed by the
  // parent's address, under nodes) the trees validate drops with.
  const { data: ancestors } = useNodeAncestors(nodeAddress ?? null, !fixedType)
  const parent = ancestors?.[0]
  const { data: allowedTypes } = useAllowedChildNodeTypes(
    parent && !fixedType ? nodeAddressOf(parent) : null,
  )

  const groups = useMemo(() => {
    if (!nodeTypes) return []
    // The allowed alternatives plus the current type, so the active type stays
    // selectable even if the parent no longer lists it.
    const names = new Set<string>(allowedTypes ?? [])
    if (currentType) names.add(currentType)
    const candidates = [...names]
      .map((name) => nodeTypes.get(name))
      .filter(
        (nodeType): nodeType is NodeType =>
          nodeType !== undefined &&
          (!nodeType.isAbstract || nodeType.name === currentType),
      )

    const byGroup = new Map<string | null, NodeType[]>()
    for (const nodeType of candidates) {
      const bucket = byGroup.get(nodeType.group) ?? []
      bucket.push(nodeType)
      byGroup.set(nodeType.group, bucket)
    }

    // Groupless types (e.g. a current type that is not user-creatable) lead,
    // then groups in configured position order, then groups a node type
    // references without a definition, alphabetically.
    const configuredOrder = sortByPosition(
      [...groupConfigs.values()].map((group) => ({
        key: group.name,
        position: group.position,
      })),
    )
    const unconfigured = [...byGroup.keys()]
      .filter(
        (name): name is string =>
          name !== null && !configuredOrder.includes(name),
      )
      .sort()

    return [null, ...configuredOrder, ...unconfigured]
      .filter((name) => byGroup.has(name))
      .map((name) => ({
        name,
        label:
          name === null
            ? null
            : humanizeLabel(groupConfigs.get(name)?.label, name),
        options: sortByPosition(
          byGroup.get(name)!.map((nodeType) => ({
            key: nodeType.name,
            position: nodeType.position,
          })),
        ).map((typeName) => ({
          value: typeName,
          label: typeLabel(nodeTypes.get(typeName)!),
        })),
      }))
  }, [nodeTypes, groupConfigs, allowedTypes, currentType])

  // Nothing to switch to - no node to resolve the position of, a structural
  // node, or no alternative at its position: the type, read-only.
  const optionCount = groups.reduce(
    (count, group) => count + group.options.length,
    0,
  )
  if (!nodeAddress || fixedType || (allowedTypes && optionCount <= 1)) {
    const nodeType = nodeTypes?.get(currentType)
    return (
      <div className="flex min-h-9 items-center gap-2 rounded-md border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400">
        {nodeTypes && (
          <NodeTypeIcon nodeTypes={nodeTypes} nodeTypeName={currentType} />
        )}
        {nodeType ? typeLabel(nodeType) : currentType}
      </div>
    )
  }

  const renderOption = (option: { value: string; label: string }) => (
    <SelectItem key={option.value} value={option.value}>
      {nodeTypes && (
        <NodeTypeIcon nodeTypes={nodeTypes} nodeTypeName={option.value} />
      )}
      {option.label}
    </SelectItem>
  )

  return (
    <Select
      value={currentType}
      onValueChange={(next) => {
        const selected = next as string | null
        if (selected && selected !== currentType) onCommit(selected)
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue>
          {(selected: string | null) => {
            const name = selected ?? currentType
            const nodeType = nodeTypes?.get(name)
            return (
              <span className="flex items-center gap-2">
                {nodeTypes && (
                  <NodeTypeIcon nodeTypes={nodeTypes} nodeTypeName={name} />
                )}
                {nodeType ? typeLabel(nodeType) : name}
              </span>
            )
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {groups.map((group) =>
          group.name === null ? (
            <Fragment key="ungrouped">
              {group.options.map(renderOption)}
            </Fragment>
          ) : (
            <SelectGroup key={group.name}>
              <SelectLabel>{group.label}</SelectLabel>
              {group.options.map(renderOption)}
            </SelectGroup>
          ),
        )}
      </SelectContent>
    </Select>
  )
}
