import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { allowsWorkspaceEditing, type EffectiveAccess } from '@/api/accessRoles'
import { apiErrorDescription } from '@/api/client'
import { queryKeys } from '@/api/keys'
import { changeBaseWorkspace, type Workspace } from '@/api/workspaces'
import { queryClient } from '@/app/queryClient'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { translate as t } from '@/lib/i18n'

/**
 * The blocking way out of a workspace an access role no longer covers.
 *
 * Roles are handed out and taken away while people are working. Someone may
 * well be sitting in live, or based on it, when a role arrives that says
 * "Entwurf only" - and from that moment every write they attempt is refused
 * by the content repository. Letting them find that out one failed save at a
 * time is the worst version of this; so is quietly moving them somewhere else
 * mid-sentence.
 *
 * Hence a dialog that cannot be dismissed: it states what happened, and the
 * only way on is picking a workspace the role does cover. Undismissable is the
 * point - anything softer is a notice people click away and then keep hitting
 * errors behind.
 *
 * Two situations reach it, and they need different repairs:
 *
 * - the EDITING CONTEXT is a shared workspace the role dropped. Purely
 *   client-side to fix: leave it.
 * - the personal workspace is BASED on a workspace the role dropped (which is
 *   what "switching to live" does in the switcher). Fixing that is a rebase,
 *   and the content repository refuses one while unpublished changes are
 *   pending - so that failure is surfaced verbatim rather than swallowed;
 *   the way out is publishing or discarding first.
 */
export function WorkspaceLockoutDialog({
  access,
  workspaces,
  personalWorkspace,
  activeWorkspace,
  onSwitchEditingContext,
}: {
  access: EffectiveAccess | undefined
  workspaces: Workspace[]
  personalWorkspace: Workspace | null
  activeWorkspace: Workspace | null
  onSwitchEditingContext: (workspaceName: string | null) => void
}) {
  const [error, setError] = useState<string | null>(null)

  const permitted = (workspace: Workspace) =>
    allowsWorkspaceEditing(access, workspace.name, workspace.classification)

  // The editing context first: it is the one the account is actually writing
  // into, and repairing it needs no server round trip.
  // Includes the personal workspace: a role may withhold that too, and when
  // no shared workspace is available to fall back to, the account is sitting
  // in one it cannot write to.
  const contextBlocked = activeWorkspace !== null && !permitted(activeWorkspace)

  const base =
    personalWorkspace?.baseWorkspace != null
      ? (workspaces.find((w) => w.name === personalWorkspace.baseWorkspace) ??
        null)
      : null
  const baseBlocked = !contextBlocked && base !== null && !permitted(base)

  const rebase = useMutation({
    mutationFn: (target: string) =>
      changeBaseWorkspace(personalWorkspace!.name, target),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
    },
    onError: (mutationError) =>
      setError(
        apiErrorDescription(
          mutationError,
          t(
            'access.lockoutRebaseFailed',
            'Switching failed. Publish or discard your pending changes first, then try again.',
          ),
        ),
      ),
  })

  if (!contextBlocked && !baseBlocked) return null

  const blockedName = contextBlocked ? activeWorkspace.name : base!.name
  // Only workspaces the role covers AND the account may write to are a way
  // out; offering one that fails on click would just move the dead end.
  const targets = workspaces.filter(
    (workspace) =>
      workspace.classification !== 'PERSONAL' &&
      workspace.permissions.write &&
      permitted(workspace),
  )

  return (
    // Controlled open with a no-op onOpenChange: Base UI asks to close on
    // Escape and outside clicks, and simply not obliging is what makes this
    // undismissable - there is no way on except picking a workspace.
    <Dialog open onOpenChange={() => {}}>
      <DialogContent size="sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {t('access.lockoutTitle', 'Your workspace is no longer available')}
          </DialogTitle>
          <DialogDescription>
            {contextBlocked
              ? t(
                  'access.lockoutContext',
                  'You are editing in "{0}", which your access role no longer covers. Pick a workspace you may work in to continue.',
                  [blockedName],
                )
              : t(
                  'access.lockoutBase',
                  'Your workspace publishes into "{0}", which your access role no longer covers. Pick a workspace you may publish into to continue.',
                  [blockedName],
                )}
          </DialogDescription>
        </DialogHeader>

        {targets.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {t(
              'access.lockoutNoTarget',
              'Your access role currently covers no workspace you could switch to. An administrator has to widen it.',
            )}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {targets.map((target) => (
              <Button
                key={target.name}
                variant="secondary"
                className="justify-start"
                disabled={rebase.isPending}
                onClick={() => {
                  setError(null)
                  if (contextBlocked) {
                    // A shared workspace it may write to is a collaborative
                    // context; anything else means going back to personal.
                    onSwitchEditingContext(
                      target.classification === 'SHARED' ? target.name : null,
                    )
                  } else {
                    rebase.mutate(target.name)
                  }
                }}
              >
                <i className="fas fa-layer-group" aria-hidden />
                {target.title || target.name}
              </Button>
            ))}
          </div>
        )}

        {error !== null && <p className="text-sm text-red-500">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}
