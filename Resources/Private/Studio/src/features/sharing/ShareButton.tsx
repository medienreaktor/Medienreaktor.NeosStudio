import { useState } from 'react'
import type { NodeDto } from '@/api/nodes'
import { Button } from '@/components/ui/button'
import { translate as t } from '@/lib/i18n'
import { ShareLinkDialog } from './ShareLinkDialog'

/**
 * Topbar button opening the Share preview link dialog for the selected
 * document. Only rendered while a document is selected - a share link always
 * pins one concrete page (in the active workspace and dimension).
 */
export function ShareButton({
  document,
  className,
}: {
  document: NodeDto
  /** E.g. the rounded-corner overrides of a split-button segment. */
  className?: string
}) {
  const label = t(
    'share.buttonHint',
    'Share a preview link to this page with people without a login',
  )
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="secondary"
        size="icon"
        className={className}
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
      >
        <i className="fas fa-fw fa-share-nodes" aria-hidden />
      </Button>

      {open && (
        <ShareLinkDialog
          document={document}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  )
}
