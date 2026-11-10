import type { Node } from '@/api/neos/schema'
import { useStudioActions } from '@/app/StudioContext'
import { Button } from '@/components/ui/button'
import { ActionIcon } from './ActionIcon'
import {
  busyKey,
  type HeaderActionContext,
  type HeaderActionDefinition,
  offered,
  runAction,
  useActionBusy,
  useHeaderActions,
} from './registry'

/**
 * The registered header actions, as icon buttons in the shell header.
 * Renders nothing without any, so the header looks as before.
 */
export function HeaderActions({
  document,
  workspaceName,
}: {
  document: Node | null
  workspaceName: string | null
}) {
  const actions = useHeaderActions()
  const studio = useStudioActions()
  if (actions.length === 0) return null
  const context: HeaderActionContext = { document, workspaceName, studio }
  const shown = actions.filter((action) => offered(action, context))
  if (shown.length === 0) return null
  return (
    <div className="flex items-center gap-1">
      {shown.map((action) => (
        <HeaderActionButton key={action.id} action={action} context={context} />
      ))}
    </div>
  )
}

function HeaderActionButton({
  action,
  context,
}: {
  action: HeaderActionDefinition
  context: HeaderActionContext
}) {
  const key = busyKey(action.id)
  const busy = useActionBusy(key)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={action.label}
      aria-label={action.label}
      aria-busy={busy || undefined}
      // The spinner in place of the icon is the busy state; the button
      // stays put, it just cannot start a second run.
      disabled={busy}
      data-action-id={action.id}
      onClick={() => runAction(action, key, () => action.run(context))}
    >
      <ActionIcon icon={action.icon} busy={busy} />
    </Button>
  )
}
