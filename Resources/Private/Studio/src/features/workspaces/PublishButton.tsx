import { useRef, useState } from 'react'
import {
  countChangedNodes,
  useWorkspaceChanges,
  type Workspace,
  type WorkspaceOperationFilter,
} from '@/api/workspaces'
import { useStudio } from '@/app/StudioContext'
import { Button } from '@/components/ui/button'
import { ConflictResolutionDialog } from './ConflictResolutionDialog'
import {
  useWorkspacePublishing,
  type WorkspaceOperation,
} from './useWorkspacePublishing'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useKeyboardShortcut } from '@/features/shortcuts/useKeyboardShortcut'
import { celebrateAround } from '@/lib/confetti'
import { cn } from '@/lib/utils'
import { translate as t } from '@/lib/i18n'

/**
 * Topbar split button for the active workspace: primary action publishes all
 * pending changes to the base workspace, the attached dropdown scopes to the
 * selected document ("this page") and offers discarding (behind a
 * confirmation - discards are irreversible). Reviewing changes and the
 * pending-count bubble live in the dedicated ReviewButton next to this one.
 * Green while there is something to publish, muted and disabled
 * otherwise. Without publish permission on the base workspace (a non-
 * LivePublisher editor) the publish actions are disabled with an explanation -
 * discarding stays available, it only touches the own workspace.
 */
export function PublishButton({ workspace }: { workspace: Workspace }) {
  const workspaceName = workspace.name
  const canPublish = workspace.permissions.publish
  // Same query the trees' dirty markers use, so button and badges agree.
  const { data: changesResponse } = useWorkspaceChanges(workspaceName)
  const { site, selectedDocument, navigateToNode } = useStudio()
  const { operation, resolve, pendingConflict, setPendingConflict } =
    useWorkspacePublishing(workspaceName)
  // A discard waiting for confirmation; the dialog is open while set.
  const [pendingDiscard, setPendingDiscard] =
    useState<WorkspaceOperation | null>(null)
  // Anchor for the confetti burst a successful "Publish all" celebrates with.
  const publishAllRef = useRef<HTMLButtonElement>(null)

  const allChanges = changesResponse?.changes ?? []
  // A workspace spans every site the account edited; scope everything (the
  // count, the badge, "all" publish/discard) to the active site so multi-site
  // setups don't cross-publish. Fall back to the whole workspace only while
  // the site is unknown (loading, or a site node absent from the subgraph).
  const siteId = site?.aggregateId ?? null
  // Keep changes of the active site, plus any whose site could not be resolved
  // (siteAggregateId === null) - never silently hide a pending change, or a
  // deletion the backend couldn't attribute to a site would look like it never
  // happened. Errs toward showing over hiding.
  const changes = siteId
    ? allChanges.filter(
        (c) => c.siteAggregateId === siteId || c.siteAggregateId === null,
      )
    : allChanges
  // Omitted filter = whole workspace; present = this site only.
  const siteFilter: WorkspaceOperationFilter | undefined = siteId
    ? { site: siteId }
    : undefined
  const changeCount = countChangedNodes(changes)
  const documentId = selectedDocument?.aggregateId ?? null
  // "This page" = changes on or within the selected document.
  const pageChangeCount = documentId
    ? countChangedNodes(
        changes.filter(
          (c) =>
            c.documentAggregateId === documentId ||
            c.nodeAggregateId === documentId,
        ),
      )
    : 0

  const hasChanges = changeCount > 0
  // Only invite the click when it can succeed: orange needs changes AND
  // publish permission on the base workspace.
  const segmentClasses =
    hasChanges && canPublish
      ? 'bg-green-500 text-white hover:bg-green-600'
      : undefined
  const segmentVariant =
    hasChanges && canPublish ? ('default' as const) : ('secondary' as const)
  const baseWorkspaceName =
    workspace.baseWorkspace ??
    t('workspace.baseWorkspaceFallback', 'the base workspace')
  const publishDeniedHint = t(
    'workspace.publishDenied',
    'You are not allowed to publish to "{0}"',
    [baseWorkspaceName],
  )

  // "Publish all" (button segment and shortcut alike) celebrates success with
  // a confetti burst off the button - the per-call onSuccess runs on top of
  // the hook's shared toast/invalidations and stays out of the scoped publish
  // and discard paths.
  const publishAll = () =>
    operation.mutate(
      { kind: 'publish', filter: siteFilter },
      { onSuccess: () => celebrateAround(publishAllRef.current) },
    )

  // Same action and guards as the primary button segment; with nothing to
  // publish the shortcut declines so the browser keeps the keystroke.
  useKeyboardShortcut({
    id: 'workspace.publish',
    combo: 'mod+shift+p',
    title: t('workspace.publishAllChanges', 'Publish all'),
    category: t('shortcuts.category.workspace', 'Workspace'),
    handler: () => {
      if (!hasChanges || !canPublish || operation.isPending) return false
      publishAll()
    },
    allowInInput: true,
  })

  return (
    <div className="flex items-center gap-3">
      {/* gap-px splits the segments with a hairline of header background */}
      <div className="flex gap-px">
        <Button
          ref={publishAllRef}
          className={cn('rounded-r-none', segmentClasses)}
          variant={segmentVariant}
          disabled={!hasChanges || !canPublish || operation.isPending}
          onClick={publishAll}
          title={
            !canPublish
              ? publishDeniedHint
              : hasChanges
                ? changeCount === 1
                  ? t('workspace.publishPendingOne', 'Publish 1 pending change')
                  : t(
                      'workspace.publishPendingMany',
                      'Publish {0} pending changes',
                      [changeCount],
                    )
                : t('workspace.noPendingChanges', 'No pending changes')
          }
        >
          <i
            className={`fas fa-fw ${operation.isPending ? 'fa-spinner fa-spin' : 'fa-arrow-up-from-bracket'}`}
            aria-hidden
          />
          {t('workspace.publishAllChanges', 'Publish all')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                className={cn('rounded-l-none px-2', segmentClasses)}
                variant={segmentVariant}
                disabled={!hasChanges || operation.isPending}
                aria-label={t(
                  'workspace.moreActions',
                  'More publish and discard actions',
                )}
              />
            }
          >
            <i className="fas fa-chevron-down text-xs" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={pageChangeCount === 0 || !canPublish}
              title={canPublish ? undefined : publishDeniedHint}
              onClick={() =>
                operation.mutate({
                  kind: 'publish',
                  filter: { document: documentId! },
                })
              }
            >
              <i className="fas fa-fw fa-file-arrow-up" aria-hidden />
              {t('workspace.publishThisPage', 'Publish this page')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={!hasChanges}
              onClick={() =>
                setPendingDiscard({ kind: 'discard', filter: siteFilter })
              }
            >
              <i className="fas fa-fw fa-trash-can" aria-hidden />
              {t('workspace.discardAll', 'Discard all')}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={pageChangeCount === 0}
              onClick={() =>
                setPendingDiscard({
                  kind: 'discard',
                  filter: { document: documentId! },
                })
              }
            >
              <i className="fas fa-fw fa-trash-can" aria-hidden />
              {t('workspace.discard.button', 'Discard')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog
        open={pendingDiscard !== null}
        onOpenChange={(open) => !open && setPendingDiscard(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingDiscard?.filter?.document
                ? t(
                    'workspace.discardPageTitle',
                    'Discard changes on this page?',
                  )
                : t('workspace.discardAllTitle', 'Discard all changes?')}
            </DialogTitle>
            <DialogDescription>
              {pendingDiscard?.filter?.document
                ? pageChangeCount === 1
                  ? t(
                      'workspace.discardPageOne',
                      '1 pending change on this page will be discarded.',
                    )
                  : t(
                      'workspace.discardPageMany',
                      '{0} pending changes on this page will be discarded.',
                      [pageChangeCount],
                    )
                : changeCount === 1
                  ? t(
                      'workspace.discardAllOne',
                      'All 1 pending change will be discarded.',
                    )
                  : t(
                      'workspace.discardAllMany',
                      'All {0} pending changes will be discarded.',
                      [changeCount],
                    )}{' '}
              {t('workspace.cannotBeUndone', 'This cannot be undone.')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPendingDiscard(null)}>
              {t('action.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDiscard) operation.mutate(pendingDiscard)
                setPendingDiscard(null)
              }}
            >
              {t('workspace.discard.button', 'Discard')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConflictResolutionDialog
        open={pendingConflict !== null}
        conflicts={pendingConflict?.conflicts.conflicts ?? []}
        partial={
          pendingConflict?.conflicts.code === 'partial_publish_conflicts'
        }
        busy={resolve.isPending}
        onCancel={() => setPendingConflict(null)}
        onForce={() => resolve.mutate('force')}
        onDiscardAll={() => resolve.mutate('discardAll')}
        onNavigate={(address) => {
          setPendingConflict(null)
          navigateToNode(address)
        }}
      />
    </div>
  )
}
