import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  isOfType,
  useNodeTypeGroups,
  useNodeTypes,
  type NodeTypeDto,
} from '@/api/nodeTypes'
import { Input } from '@/components/ui/input'
import { humanizeLabel } from '@/features/inspector/inspectorSchema'
import { NodeTypeIcon } from '@/features/tree/nodeTypeIcon'
import { sortByPosition } from '@/lib/positional'
import { endCreationDrag, startCreationDrag } from './creationDrag'

const CONTENT_SUPER_TYPE = 'Neos.Neos:Content'

/**
 * The dataTransfer type of a node-type drag. The payload (the node type
 * name) additionally travels through the creationDrag bus, because HTML5
 * only exposes dataTransfer contents on drop - the guest script needs the
 * dragged type during dragover to mark valid collections.
 */
export const NODE_TYPE_DATA_TRANSFER = 'application/x-neos-studio-nodetype'

interface CreatableNodeType {
  name: string
  label: string
  icon: string | null
}

/**
 * All creatable content node types, grouped like the classic UI's node
 * creation dialog: non-abstract Neos.Neos:Content subtypes with a ui.group,
 * ordered by the group definitions (Neos.Neos.nodeTypes.groups) and their
 * ui.position within the group. Items are dragged into the preview, where
 * content collections that allow the type light up as drop targets.
 */
export function NodeCreationPanel() {
  const { data: nodeTypes } = useNodeTypes()
  const { data: groupConfigs } = useNodeTypeGroups()
  const [filter, setFilter] = useState('')
  const [toggled, setToggled] = useState<Record<string, boolean>>({})

  const groups = useMemo(() => {
    if (!nodeTypes || !groupConfigs) return null
    const byGroup = new Map<
      string,
      { nodeType: NodeTypeDto; label: string }[]
    >()
    for (const nodeType of nodeTypes.values()) {
      if (nodeType.abstract || nodeType.group === null) continue
      if (!isOfType(nodeTypes, nodeType.name, CONTENT_SUPER_TYPE)) continue
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

    return [...configuredOrder, ...unconfigured]
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
  }, [nodeTypes, groupConfigs])

  if (groups === null) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        Loading node types…
      </div>
    )
  }

  const query = filter.trim().toLowerCase()
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      nodeTypes: query
        ? group.nodeTypes.filter(
            (nodeType) =>
              nodeType.label.toLowerCase().includes(query) ||
              nodeType.name.toLowerCase().includes(query),
          )
        : group.nodeTypes,
    }))
    .filter((group) => group.nodeTypes.length > 0)

  return (
    <div className="@container flex flex-col gap-2 p-2">
      <Input
        type="search"
        placeholder="Filter node types…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        className="h-8"
      />
      {visibleGroups.length === 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          {groups.length === 0
            ? 'No creatable content node types.'
            : 'No node types match the filter.'}
        </p>
      )}
      {visibleGroups.map((group) => {
        // While filtering every group with matches stays open.
        const isCollapsed =
          query === '' && (toggled[group.name] ?? group.collapsed)
        return (
          <section key={group.name}>
            <button
              type="button"
              className="flex w-full items-center gap-1 rounded px-1 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
              onClick={() =>
                setToggled((previous) => ({
                  ...previous,
                  [group.name]: !isCollapsed,
                }))
              }
            >
              {isCollapsed ? (
                <ChevronRight className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
              {group.label}
            </button>
            {!isCollapsed && (
              <ul className="grid grid-cols-2 gap-1 @[18rem]:grid-cols-3">
                {group.nodeTypes.map((nodeType) => (
                  <li key={nodeType.name}>
                    <div
                      draggable
                      title={`${nodeType.label} (${nodeType.name}) - drag into the preview`}
                      className="flex h-full cursor-grab flex-col items-center justify-center gap-1.5 rounded border border-border bg-muted/40 px-1 py-3 text-center hover:bg-accent active:cursor-grabbing"
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'copy'
                        event.dataTransfer.setData(
                          NODE_TYPE_DATA_TRANSFER,
                          nodeType.name,
                        )
                        startCreationDrag(nodeType.name)
                      }}
                      onDragEnd={() => endCreationDrag()}
                    >
                      <NodeTypeIcon
                        nodeTypes={nodeTypes}
                        nodeTypeName={nodeType.name}
                        className="text-base"
                      />
                      <span className="line-clamp-2 w-full wrap-break-word text-xs leading-tight">
                        {nodeType.label}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
