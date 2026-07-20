import { useState } from 'react'
import { CollapsibleGroup } from '@/components/ui/collapsible-group'
import { Input } from '@/components/ui/input'
import { LoadingState } from '@/components/ui/spinner'
import { Placeholder } from '@/components/ui/placeholder'
import { NodeTypeIcon } from '@/features/tree/nodeTypeIcon'
import {
  filterCreatableGroups,
  useCreatableNodeTypes,
} from './creatableNodeTypes'
import { endCreationDrag, startCreationDrag } from './creationDrag'

const CONTENT_SUPER_TYPE = 'Neos.Neos:Content'

/**
 * The dataTransfer type of a node-type drag. The payload (the node type
 * name) additionally travels through the creationDrag bus, because HTML5
 * only exposes dataTransfer contents on drop - the guest script needs the
 * dragged type during dragover to mark valid collections.
 */
export const NODE_TYPE_DATA_TRANSFER = 'application/x-neos-studio-nodetype'

/**
 * All creatable content node types, grouped like the classic UI's node
 * creation dialog (see useCreatableNodeTypes). Items are dragged into the
 * preview, where content collections that allow the type light up as drop
 * targets.
 */
export function NodeCreationPanel() {
  const creatable = useCreatableNodeTypes([CONTENT_SUPER_TYPE])
  const [filter, setFilter] = useState('')
  const [toggled, setToggled] = useState<Record<string, boolean>>({})

  if (creatable === null) {
    return <LoadingState label="Loading node types…" />
  }
  const { groups, nodeTypes } = creatable

  const query = filter.trim().toLowerCase()
  const visibleGroups = query
    ? filterCreatableGroups(
        groups,
        (nodeType) =>
          nodeType.label.toLowerCase().includes(query) ||
          nodeType.name.toLowerCase().includes(query),
      )
    : groups

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
        <Placeholder
          icon={groups.length === 0 ? 'fa-cube' : 'fa-magnifying-glass'}
          title={
            groups.length === 0
              ? 'No creatable content node types.'
              : 'No node types match the filter.'
          }
          className="py-10"
        />
      )}
      {visibleGroups.map((group) => (
        <CollapsibleGroup
          key={group.name}
          label={group.label}
          // While filtering every group with matches stays open; the default
          // comes from the group's configured collapsed flag.
          open={query !== '' || !(toggled[group.name] ?? group.collapsed)}
          onOpenChange={(open) =>
            setToggled((previous) => ({ ...previous, [group.name]: !open }))
          }
        >
          <ul className="grid grid-cols-2 gap-1 @[24rem]:grid-cols-3 @[32rem]:grid-cols-4 @[40rem]:grid-cols-5 @[48rem]:grid-cols-6">
            {group.nodeTypes.map((nodeType) => (
              <li key={nodeType.name}>
                <div
                  draggable
                  title={`${nodeType.label} (${nodeType.name}) - drag into the preview`}
                  className="flex h-20 cursor-grab flex-col items-center justify-center gap-2 rounded border border-neutral-700 bg-neutral-800/40 px-2 pt-2 pb-1 text-center hover:bg-neutral-800 active:cursor-grabbing"
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
        </CollapsibleGroup>
      ))}
    </div>
  )
}
