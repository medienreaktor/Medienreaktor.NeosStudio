import type { ReactNode } from 'react'
import type { NodeTypeMap } from '@/api/nodeTypes'
import type { NodeDto } from '@/api/nodes'
import { cn } from '@/lib/utils'
import { NodeTypeIcon } from './nodeTypeIcon'
import type { PendingChanges } from './usePendingChanges'

export interface TreeRowDecor {
  icon?: ReactNode
  markers?: ReactNode
  dimmed?: boolean
}

/**
 * Row decorations shared by the document tree and the content outliner.
 *
 * Visibility states dim the whole row (icon + label); hidden nodes (the
 * disabled subtree tag, as opposed to merely hidden-in-menus) additionally
 * get a red x badge layered onto the type icon. Dirty markers on the right:
 * filled dot for changes on the node itself, hollow dot for documents that
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
  const dimmed = hidden || hiddenInMenu
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

  const iconTitle = hidden
    ? hiddenInherited
      ? 'Hidden (inherited)'
      : 'Hidden'
    : hiddenInMenu
      ? 'Hidden in menus'
      : undefined

  return {
    icon: (
      <span className="relative" title={iconTitle}>
        {/* Dim the type icon with the label; the alert badge stays crisp. */}
        <NodeTypeIcon nodeTypes={nodeTypes} nodeTypeName={node.nodeType} className={cn(dimmed && 'opacity-50')} />
        {hidden && (
          <i
            className="fas fa-circle-xmark absolute -bottom-1 -right-1 rounded-full bg-card text-[0.6rem] text-destructive"
            aria-hidden
          />
        )}
      </span>
    ),
    dimmed,
    markers: markers.length > 0 ? markers : undefined,
  }
}
