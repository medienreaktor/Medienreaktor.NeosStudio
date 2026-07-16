import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchAllowedChildNodeTypes,
  fetchAncestors,
  useNode,
} from '@/api/nodes'
import { type NodeTypeDto, useNodeTypes } from '@/api/nodeTypes'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { humanizeLabel } from '@/features/inspector/inspectorSchema'
import { NodeTypeIcon } from '@/features/tree/nodeTypeIcon'
import type { PropertyEditorComponent } from '../registry'

export const NODE_TYPE_EDITOR = 'Neos.Neos/Inspector/Editors/NodeTypeEditor'

const typeLabel = (nodeType: NodeTypeDto): string =>
  humanizeLabel(nodeType.label, nodeType.name.split(':').pop() ?? nodeType.name)

/**
 * Switches a node's type. The alternatives offered are the node types allowed
 * at the node's position - i.e. the ones its parent accepts as children
 * (server-computed, honoring tethered-collection constraints), narrowed to
 * concrete types. Picking one commits the new type name; the host runs the
 * ChangeNodeAggregateType command (see the inspector's Node Data tab).
 *
 * Inspector-only: it needs the node's address to resolve the parent, so
 * without one (e.g. in a creation dialog) it degrades to a read-only type
 * name - as it also does when the position offers no real alternative.
 */
export const NodeTypeEditor: PropertyEditorComponent = ({
  value,
  onCommit,
  nodeAddress,
}) => {
  const { data: nodeTypes } = useNodeTypes()
  const currentType = typeof value === 'string' ? value : ''

  // Tethered (auto-created) and root nodes are structural - their type is fixed
  // even though _nodeType still appears on them. Read from cache (the inspector
  // already fetched this node).
  const { data: self } = useNode(nodeAddress ?? '', nodeAddress !== undefined)
  const switchable =
    !self ||
    (self.classification !== 'tethered' && self.classification !== 'root')

  const { data: allowedTypes } = useQuery({
    queryKey: ['nodeTypeSwitcher', 'allowedForParentOf', nodeAddress],
    enabled: nodeAddress !== undefined,
    // Constraints follow from the (immutable) node type model - stable for the session.
    staleTime: Infinity,
    queryFn: async () => {
      const [parent] = await fetchAncestors(nodeAddress!)
      return parent ? fetchAllowedChildNodeTypes(parent.address) : []
    },
  })

  const options = useMemo(() => {
    if (!nodeTypes) return []
    // The allowed alternatives plus the current type, so the active type stays
    // selectable even if the parent no longer lists it.
    const names = new Set<string>(allowedTypes ?? [])
    if (currentType) names.add(currentType)
    return [...names]
      .map((name) => nodeTypes.get(name))
      .filter(
        (nodeType): nodeType is NodeTypeDto =>
          nodeType !== undefined &&
          (!nodeType.abstract || nodeType.name === currentType),
      )
      .map((nodeType) => ({ value: nodeType.name, label: typeLabel(nodeType) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [nodeTypes, allowedTypes, currentType])

  return (
    <Select
      value={currentType}
      onValueChange={(next) => {
        const selected = next as string | null
        if (selected && selected !== currentType && switchable)
          onCommit(selected)
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
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {nodeTypes && (
              <NodeTypeIcon nodeTypes={nodeTypes} nodeTypeName={option.value} />
            )}
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
