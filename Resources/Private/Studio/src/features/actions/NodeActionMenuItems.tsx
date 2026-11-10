import { labelOf } from '@/lib/registry'
import type { Node } from '@/api/neos/schema'
import { useStudioActions } from '@/app/StudioContext'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { translate as t } from '@/lib/i18n'
import { ActionIcon } from './ActionIcon'
import {
  busyKey,
  type NodeActionContext,
  type NodeActionDefinition,
  type NodeActionSurface,
  offeredNodeActionGroups,
  runAction,
  useActionBusy,
  useNodeActions,
} from './registry'

/**
 * The registered node actions offered for a node, as items of the menu they
 * are rendered into: one block per group, each led by a separator (the
 * built-in items come first). Renders nothing when no action is offered,
 * separators included.
 */
export function NodeActionMenuItems({
  node,
  surface,
  selection,
  leadingSeparator = true,
  onSelect,
}: {
  node: Node
  surface: NodeActionSurface
  /** The nodes the invocation is about; defaults to the node alone. */
  selection?: Node[]
  /** Separate the first group from items above it. */
  leadingSeparator?: boolean
  /** An action was picked - for menus that close themselves (controlled ones). */
  onSelect?: () => void
}) {
  const actions = useNodeActions()
  const studio = useStudioActions()
  if (actions.length === 0) return null
  const context: NodeActionContext = {
    surface,
    selection: selection && selection.length > 0 ? selection : [node],
    studio,
  }
  const groups = offeredNodeActionGroups(actions, node, context)
  return groups.map((group, index) => (
    <NodeActionGroup
      key={group[0]?.id ?? index}
      actions={group}
      node={node}
      context={context}
      separator={leadingSeparator || index > 0}
      onSelect={onSelect}
    />
  ))
}

/**
 * A "..." menu button offering the registered node actions for one node -
 * for bars that act on a node without a context menu of their own (the
 * documents toolbar, on the selected document). Renders nothing while no
 * action is offered, so the bar looks as before without plugins.
 */
export function NodeActionsMenuButton({
  node,
  surface,
  className,
}: {
  node: Node | null
  surface: NodeActionSurface
  /** Classes for the trigger button, to blend into its bar. */
  className?: string
}) {
  const actions = useNodeActions()
  const studio = useStudioActions()
  if (node === null || actions.length === 0) return null
  const context: NodeActionContext = { surface, selection: [node], studio }
  const groups = offeredNodeActionGroups(actions, node, context)
  if (groups.length === 0) return null
  const label = t('actions.more', 'More actions')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            title={label}
            aria-label={label}
            className={className}
          />
        }
      >
        <i className="fas fa-ellipsis" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {groups.map((group, index) => (
          <NodeActionGroup
            key={group[0]?.id ?? index}
            actions={group}
            node={node}
            context={context}
            separator={index > 0}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function NodeActionGroup({
  actions,
  node,
  context,
  separator,
  onSelect,
}: {
  actions: NodeActionDefinition[]
  node: Node
  context: NodeActionContext
  separator: boolean
  onSelect?: () => void
}) {
  return (
    <>
      {separator && <DropdownMenuSeparator />}
      {actions.map((action) => (
        <NodeActionItem
          key={action.id}
          action={action}
          node={node}
          context={context}
          onSelect={onSelect}
        />
      ))}
    </>
  )
}

function NodeActionItem({
  action,
  node,
  context,
  onSelect,
}: {
  action: NodeActionDefinition
  node: Node
  context: NodeActionContext
  onSelect?: () => void
}) {
  const key = busyKey(action.id, node)
  const busy = useActionBusy(key)
  return (
    <DropdownMenuItem
      variant={action.destructive ? 'destructive' : 'default'}
      // A run still pending for this node: shown, but not startable twice.
      disabled={busy}
      data-action-id={action.id}
      onClick={() => {
        onSelect?.()
        // The menu closes on click, taking the item's spinner with it - so
        // a slow run announces itself with a loading toast instead.
        runAction(action, key, () => action.run(node, context), {
          announce: true,
        })
      }}
    >
      <ActionIcon icon={action.icon} busy={busy} />
      {labelOf(action.label)}
    </DropdownMenuItem>
  )
}
