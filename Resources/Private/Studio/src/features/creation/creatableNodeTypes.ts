import { useMemo } from 'react'
import {
  isOfType,
  useNodeTypeGroups,
  useNodeTypes,
  type NodeTypeDto,
  type NodeTypeMap,
} from '@/api/nodeTypes'
import { humanizeLabel } from '@/features/inspector/inspectorSchema'
import { sortByPosition } from '@/lib/positional'

export interface CreatableNodeType {
  name: string
  label: string
  icon: string | null
}

export interface CreatableNodeTypeGroup {
  name: string
  label: string
  collapsed: boolean
  nodeTypes: CreatableNodeType[]
}

/**
 * All creatable node types of the given roles, grouped like the classic UI's
 * node creation dialog: non-abstract subtypes of one of the super types with
 * a ui.group (only grouped types are user-creatable, by Neos convention),
 * ordered by the group definitions (Neos.Neos.nodeTypes.groups) and their
 * ui.position within the group. Returns null while the node types load.
 *
 * Shared by the creation panel (all content types, for dragging) and the
 * insertion dialog (constraint-filtered per insertion point).
 */
export function useCreatableNodeTypes(
  superTypes: string[],
): { groups: CreatableNodeTypeGroup[]; nodeTypes: NodeTypeMap } | null {
  const { data: nodeTypes } = useNodeTypes()
  const { data: groupConfigs } = useNodeTypeGroups()

  return useMemo(() => {
    if (!nodeTypes || !groupConfigs) return null
    const byGroup = new Map<
      string,
      { nodeType: NodeTypeDto; label: string }[]
    >()
    for (const nodeType of nodeTypes.values()) {
      if (nodeType.abstract || nodeType.group === null) continue
      if (
        !superTypes.some((superType) =>
          isOfType(nodeTypes, nodeType.name, superType),
        )
      )
        continue
      const label = humanizeLabel(
        nodeType.label,
        nodeType.name.split(':').pop() ?? nodeType.name,
      )
      const entries = byGroup.get(nodeType.group) ?? []
      entries.push({ nodeType, label })
      byGroup.set(nodeType.group, entries)
    }

    // Groups in configured position order; unconfigured groups (a node type
    // referencing an unknown group) trail in name order.
    const configuredOrder = sortByPosition(
      Object.entries(groupConfigs).map(([key, config]) => ({
        key,
        position: config?.position,
      })),
    )
    const unconfigured = [...byGroup.keys()]
      .filter((name) => !configuredOrder.includes(name))
      .sort()

    const groups = [...configuredOrder, ...unconfigured]
      .filter((name) => byGroup.has(name))
      .map((name) => ({
        name,
        label: humanizeLabel(groupConfigs[name]?.label, name),
        collapsed: groupConfigs[name]?.collapsed === true,
        nodeTypes: sortByPosition(
          byGroup.get(name)!.map(({ nodeType }) => ({
            key: nodeType.name,
            position: nodeType.position,
          })),
        ).map((typeName): CreatableNodeType => {
          const entry = byGroup
            .get(name)!
            .find((candidate) => candidate.nodeType.name === typeName)!
          return {
            name: typeName,
            label: entry.label,
            icon: entry.nodeType.icon,
          }
        }),
      }))
    return { groups, nodeTypes }
    // superTypes is spread so a caller-side array literal does not re-run
    // the memo every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeTypes, groupConfigs, superTypes.join(',')])
}

/**
 * The groups reduced to the node types passing the predicate (a search query,
 * a server-computed allowed-child-types list), dropping emptied groups.
 */
export function filterCreatableGroups(
  groups: CreatableNodeTypeGroup[],
  predicate: (nodeType: CreatableNodeType) => boolean,
): CreatableNodeTypeGroup[] {
  return groups
    .map((group) => ({
      ...group,
      nodeTypes: group.nodeTypes.filter(predicate),
    }))
    .filter((group) => group.nodeTypes.length > 0)
}
