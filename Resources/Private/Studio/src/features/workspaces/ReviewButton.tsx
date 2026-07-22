import { useState } from 'react'
import type { Workspace } from '@/api/workspaces'
import { Button } from '@/components/ui/button'
import { translate as t } from '@/lib/i18n'
import { ReviewChangesDialog } from './ReviewChangesDialog'

/**
 * Topbar button opening the Review changes dialog. Always enabled - the
 * dialog reviews any source/target workspace pair the account can see, so it
 * is useful even while the active workspace itself has nothing to publish
 * (e.g. reviewing what a shared draft would publish to live).
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

  return (
    <>
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
