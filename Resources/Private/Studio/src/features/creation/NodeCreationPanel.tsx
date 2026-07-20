import { useState } from 'react'
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
      {visibleGroups.map((group) => {
        // While filtering every group with matches stays open.
        const isCollapsed =
          query === '' && (toggled[group.name] ?? group.collapsed)
        return (
          <section key={group.name}>
            <button
              type="button"
              className="flex w-full items-center gap-1 rounded px-1 py-1 text-xs font-semibold text-neutral-400 hover:text-white"
              onClick={() =>
                setToggled((previous) => ({
                  ...previous,
                  [group.name]: !isCollapsed,
                }))
              }
            >
              {isCollapsed ? (
                <i
                  className="fas fa-chevron-right text-[0.75rem]"
                  aria-hidden
                />
              ) : (
                <i className="fas fa-chevron-down text-[0.75rem]" aria-hidden />
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
                      className="flex h-full cursor-grab flex-col items-center justify-center gap-1.5 rounded border border-neutral-700 bg-neutral-800/40 px-1 py-3 text-center hover:bg-neutral-800 active:cursor-grabbing"
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
