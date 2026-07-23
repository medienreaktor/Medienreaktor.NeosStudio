import { useState } from 'react'
import {
  countChangedNodes,
  useWorkspaceChanges,
  type Workspace,
} from '@/api/workspaces'
import { useStudio } from '@/app/StudioContext'
import { Button } from '@/components/ui/button'
import { translate as t } from '@/lib/i18n'
import { ReviewChangesDialog } from './ReviewChangesDialog'

/**
 * Topbar button opening the Review changes dialog. Always enabled - the
 * dialog reviews any source/target workspace pair the account can see, so it
 * is useful even while the active workspace itself has nothing to publish
 * (e.g. reviewing what a shared draft would publish to live).
 *
 * Carries the pending-changes bubble for the active workspace, scoped to the
 * active site the same way the Publish button's counts are - reviewing is
 * where that number leads, publishing is just the exit.
 */
export function ReviewButton({
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
  // Same query the Publish button and the trees' dirty markers use, so the
  // bubble always agrees with them.
  const { data: changesResponse } = useWorkspaceChanges(activeWorkspace.name)
  const { site } = useStudio()
  const siteId = site?.aggregateId ?? null
  const allChanges = changesResponse?.changes ?? []
  // Active site's changes plus any whose site could not be resolved - never
  // silently hide a pending change (mirrors the Publish button).
  const changeCount = countChangedNodes(
    siteId
      ? allChanges.filter(
          (c) => c.siteAggregateId === siteId || c.siteAggregateId === null,
        )
      : allChanges,
  )

  return (
    <>
      <div className="relative">
        <Button
          variant="secondary"
          onClick={() => setOpen(true)}
          title={t(
            'workspace.review.buttonHint',
            'Review pending changes between workspaces',
          )}
        >
          <i className="fas fa-fw fa-list-check" aria-hidden />
          <span className="hidden @[64rem]:inline">
            {t('workspace.review.button', 'Review')}
          </span>
        </Button>
        {changeCount > 0 && (
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
      />
    </>
  )
}
