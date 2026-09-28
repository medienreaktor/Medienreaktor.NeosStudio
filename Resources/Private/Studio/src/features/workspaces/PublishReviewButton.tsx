import { useState } from 'react'
import {
  countChangedNodes,
  useWorkspaceChanges,
  type Workspace,
} from '@/api/workspaces'
import { useStudio } from '@/app/StudioContext'
import { Button } from '@/components/ui/button'
import { useKeyboardShortcut } from '@/features/shortcuts/useKeyboardShortcut'
import { translate as t } from '@/lib/i18n'
import { ReviewChangesDialog } from './ReviewChangesDialog'
import { useCanPublish } from './useWorkspacePublishing'

/**
 * The topbar's single publish entry point: opens the Review changes dialog -
 * publishing always goes through the review, never straight from the topbar.
 * Always enabled, since every editor may review (the dialog also covers any
 * other source/target pair the account can see); publishing itself is gated
 * inside the dialog by useCanPublish (Neos.Neos:LivePublisher for live).
 *
 * Colored while the active workspace has changes the account may publish -
 * blue into live, purple into a shared workspace - neutral otherwise. Carries
 * the pending-changes bubble for the active workspace, scoped to the active
 * site (plus changes whose site could not be resolved - never silently hide a
 * pending change), matching the review list.
 */
export function PublishReviewButton({
  workspaces,
  activeWorkspace,
  onNavigate,
}: {
  workspaces: Workspace[]
  activeWorkspace: Workspace
  /** See ReviewChangesDialog: show a document, switching the context first. */
  onNavigate: (address: string, workspaceName: string) => void
}) {
  const [open, setOpen] = useState(false)
  // Same query the trees' dirty markers use, so the bubble always agrees.
  const { data: changesResponse } = useWorkspaceChanges(activeWorkspace.name)
  const { site } = useStudio()
  const siteId = site?.aggregateId ?? null
  const allChanges = changesResponse?.changes ?? []
  const changeCount = countChangedNodes(
    siteId
      ? allChanges.filter(
          (c) => c.siteAggregateId === siteId || c.siteAggregateId === null,
        )
      : allChanges,
  )
  const canPublish = useCanPublish(activeWorkspace, workspaces)
  const hasChanges = changeCount > 0

  const baseWorkspace = workspaces.find(
    (w) => w.name === activeWorkspace.baseWorkspace,
  )
  const targetLabel =
    baseWorkspace?.classification === 'ROOT'
      ? t('workspace.live', 'Live')
      : baseWorkspace?.title ||
        activeWorkspace.baseWorkspace ||
        t('workspace.baseWorkspaceFallback', 'the base workspace')

  // Active (changes the account may publish): colored like the switcher's
  // target badge - primary blue into live, purple into anything else.
  const active = hasChanges && canPublish
  const activeClasses =
    baseWorkspace?.classification === 'ROOT'
      ? undefined
      : 'bg-purple-500 hover:bg-purple-500/90'

  // The former "publish all" shortcut now opens the review as well.
  useKeyboardShortcut({
    id: 'workspace.publish',
    key: 'p',
    title: t('workspace.reviewAndPublish', 'Review and publish'),
    category: t('shortcuts.category.workspace', 'Workspace'),
    handler: () => {
      if (open) return false
      setOpen(true)
    },
  })

  return (
    <>
      <div className="relative">
        <Button
          variant={active ? 'default' : 'secondary'}
          className={active ? activeClasses : undefined}
          onClick={() => setOpen(true)}
          title={
            canPublish
              ? t(
                  'workspace.review.buttonHint',
                  'Review pending changes between workspaces',
                )
              : t(
                  'workspace.publishDenied',
                  'You are not allowed to publish to "{0}"',
                  [targetLabel],
                )
          }
        >
          <i className="fas fa-fw fa-arrow-up-from-bracket" aria-hidden />
          <span className="hidden @[56rem]:inline">
            {t('workspace.reviewAndPublish', 'Review and publish')}
          </span>
        </Button>
        {hasChanges && (
          <span
            className="absolute -top-2 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-semibold text-white tabular-nums"
            aria-label={t('workspace.pendingBadge', '{0} pending changes', [
              changeCount,
            ])}
          >
            {changeCount}
          </span>
        )}
      </div>

      <ReviewChangesDialog
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        open={open}
        onOpenChange={setOpen}
        onNavigate={onNavigate}
        preselectAll
      />
    </>
  )
}
