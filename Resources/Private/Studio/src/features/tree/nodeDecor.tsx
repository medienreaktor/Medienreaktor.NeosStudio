import type { ReactNode } from 'react'
import type { NodeTypeMap } from '@/api/nodeTypes'
import type { NodeDto } from '@/api/nodes'
import { NodeTypeIcon } from './nodeTypeIcon'
import type { PendingChanges } from './usePendingChanges'

export interface TreeRowDecor {
  icon?: ReactNode
  markers?: ReactNode
  dimmed?: boolean
}

/**
 * Row decorations shared by the document tree and the content outliner:
 * node type icon, hidden/hidden-in-menu markers, dirty (pending change)
 * dots - filled for changes on the node itself, hollow for documents that
 * contain changed content.
 */
export function nodeDecor(
  node: NodeDto,
  nodeTypes: NodeTypeMap | undefined,
  changed: PendingChanges | null,
): TreeRowDecor {
  const hidden = node.tags.all.includes('disabled')
  const hiddenInherited = node.tags.inherited.includes('disabled')
  const hiddenInMenu = node.properties['hiddenInMenu']?.value === true
  const isDirty = changed !== null && changed.ids.has(node.aggregateId)
  const containsDirty = !isDirty && changed !== null && changed.documentIds.has(node.aggregateId)

  const markers: ReactNode[] = []
  if (isDirty) {
    markers.push(
      <span
        key="dirty"
        title={`Modified in workspace "${changed.workspace}"`}
        className="size-1.5 rounded-full bg-warn"
      />,
    )
  }
  if (containsDirty) {
    markers.push(
      <span
        key="containsDirty"
        title={`Contains changes in workspace "${changed.workspace}"`}
        className="size-1.5 rounded-full border border-warn"
      />,
    )
  }
  if (hidden) {
    markers.push(
      <span key="hidden" title={hiddenInherited ? 'Hidden (inherited)' : 'Hidden'}>
        <i className="fas fa-eye-slash text-[0.65rem]" aria-hidden />
      </span>,
    )
  }
  if (hiddenInMenu) {
    markers.push(
      <span key="hiddenInMenu" title="Hidden in menus">
        <i className="fas fa-bars text-[0.65rem]" aria-hidden />
      </span>,
    )
  }

  return {
    icon: <NodeTypeIcon nodeTypes={nodeTypes} nodeTypeName={node.nodeType} />,
    dimmed: hidden,
    markers: markers.length > 0 ? markers : undefined,
  }
}
