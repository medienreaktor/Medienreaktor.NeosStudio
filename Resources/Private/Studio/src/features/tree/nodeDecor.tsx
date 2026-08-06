import type { ReactNode } from 'react'
import type { NodeTypeMap } from '@/api/nodeTypes'
import type { NodeDto } from '@/api/nodes'
import type { PresencePeer } from '@/features/collaboration/PresenceContext'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  mergeNodeDecorations,
  nodeDecoratorRegistry,
  type NodeDecoratorDefinition,
} from './decorators'
import { faClassName } from './nodeTypeIcon'
import type { PendingChanges } from './usePendingChanges'

export interface TreeRowDecor {
  icon?: ReactNode
  markers?: ReactNode
  /** Binary row dimming (the cut clipboard entry, media tree states). */
  dimmed?: boolean
  /** Row text color contributed by node decorators (icon + label). */
  color?: string
  /** Row opacity contributed by node decorators (icon + label). */
  opacity?: number
}

/**
 * Badge corner offsets on the type icon, by NodeDecorationOverlay position.
 * At most 2px outside the icon box: the rows clip their content
 * (overflow-hidden), so a badge reaching further out gets cropped.
 */
const OVERLAY_POSITION = {
  'top-left': '-top-0.5 -left-0.5',
  'top-right': '-top-0.5 -right-0.5',
  'bottom-left': '-bottom-0.5 -left-0.5',
  'bottom-right': '-bottom-0.5 -right-0.5',
} as const

/**
 * Row decorations shared by the document tree, the content outliner, the
 * search results and the document pickers.
 *
 * Icon, overlay badges, row color and row opacity come from the node
 * decorator registry (see decorators.ts) - the built-in decorators cover the
 * configured type icon, hidden/hidden-in-menu dimming with the red x badge,
 * and the deleted badge; plugins contribute theirs the same way. The base
 * icon dims and tints with the row; badges stay crisp.
 *
 * Dirty markers on the right: filled dot for changes on the node itself,
 * hollow dot for documents that contain changed content. Presence:
 * collaborators standing on this node render as small initials chips in
 * their color (before the dirty markers).
 */
export function nodeDecor(
  node: NodeDto,
  nodeTypes: NodeTypeMap | undefined,
  changed: PendingChanges | null,
  peersHere: PresencePeer[] = [],
  // Render-subscribed callers pass useNodeDecorators(); the fallback serves
  // plain-function contexts (same registry, just no re-render on register).
  decorators: NodeDecoratorDefinition[] = nodeDecoratorRegistry.getAll(),
): TreeRowDecor {
  const decoration = mergeNodeDecorations(node, { nodeTypes }, decorators)
  const isDirty = changed !== null && changed.ids.has(node.aggregateId)
  const containsDirty =
    !isDirty && changed !== null && changed.documentIds.has(node.aggregateId)

  const markers: ReactNode[] = []
  for (const peer of peersHere) {
    markers.push(
      <span
        key={`presence-${peer.userId}`}
        title={t('tree.decor.editingHere', '{0} is here', [peer.name])}
        className="flex size-4 items-center justify-center rounded-full text-[0.5rem] font-semibold text-white select-none"
        style={{ backgroundColor: peer.color }}
      >
        {peer.initials}
      </span>,
    )
  }
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

  return {
    icon: (
      <span
        className="relative"
        title={
          decoration.titles.length > 0
            ? decoration.titles.join('\n')
            : undefined
        }
      >
        <i
          className={cn(
            faClassName(decoration.icon ?? 'cube'),
            'fa-fw text-[0.75rem]',
          )}
          style={{ color: decoration.color, opacity: decoration.opacity }}
          aria-hidden
        />
        {decoration.overlays.map((overlay, index) => (
          <i
            key={index}
            title={overlay.label}
            className={cn(
              faClassName(overlay.icon),
              'absolute rounded-full bg-neutral-50 dark:bg-neutral-900 text-[0.6rem]',
              OVERLAY_POSITION[overlay.position ?? 'bottom-right'],
            )}
            style={{ color: overlay.color ?? 'var(--color-red-500)' }}
            aria-hidden
          />
        ))}
      </span>
    ),
    color: decoration.color,
    opacity: decoration.opacity,
    markers: markers.length > 0 ? markers : undefined,
  }
}
