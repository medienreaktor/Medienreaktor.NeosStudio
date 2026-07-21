import type { ReactNode } from 'react'
import type { NodeTypeMap } from '@/api/nodeTypes'
import { isExplicitlyHidden, type NodeDto } from '@/api/nodes'
import { translate as t } from '@/lib/i18n'
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
 * Visibility states dim the whole row (icon + label), including nodes only
 * hidden by inheritance from a hidden ancestor. A red x badge is layered onto
 * the type icon only for explicitly hidden nodes (the disabled tag set on the
 * node itself) - not for descendants that merely inherit the subtree tag.
 * Dirty markers on the right:
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
  const hiddenExplicitly = isExplicitlyHidden(node)
  const hiddenInMenu = node.properties['hiddenInMenu']?.value === true
  const dimmed = hidden || hiddenInMenu
  const isDirty = changed !== null && changed.ids.has(node.aggregateId)
  const containsDirty =
    !isDirty && changed !== null && changed.documentIds.has(node.aggregateId)

  const markers: ReactNode[] = []
  if (isDirty) {
    markers.push(
      <span
        key="dirty"
        title={t('tree.decor.modified', 'Modified in workspace "{0}"', [
          changed.workspace,
        ])}
        className="size-1.5 rounded-full bg-orange-500"
      />,
    )
  }
  if (containsDirty) {
    markers.push(
      <span
        key="containsDirty"
        title={t(
          'tree.decor.containsChanges',
          'Contains changes in workspace "{0}"',
          [changed.workspace],
        )}
        className="size-1.5 rounded-full border border-orange-500"
      />,
    )
  }

  const iconTitle = hidden
    ? hiddenInherited
      ? t('tree.decor.hiddenInherited', 'Hidden (inherited)')
      : t('tree.decor.hidden', 'Hidden')
    : hiddenInMenu
      ? t('tree.decor.hiddenInMenu', 'Hidden in menus')
      : undefined

  return {
    icon: (
      <span className="relative" title={iconTitle}>
        {/* Dim the type icon with the label; the alert badge stays crisp. */}
        <NodeTypeIcon
          nodeTypes={nodeTypes}
          nodeTypeName={node.nodeType}
          className={cn(dimmed && 'opacity-50')}
        />
        {hiddenExplicitly && (
          <i
            className="fas fa-circle-xmark absolute -bottom-1 -right-1 rounded-full bg-neutral-900 text-[0.6rem] text-red-500"
            aria-hidden
          />
        )}
      </span>
    ),
    dimmed,
    markers: markers.length > 0 ? markers : undefined,
  }
}
