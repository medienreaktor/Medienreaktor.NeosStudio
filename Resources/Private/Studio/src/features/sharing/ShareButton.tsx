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
export function ShareButton({ document }: { document: NodeDto }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => setOpen(true)}
        title={t(
          'share.buttonHint',
          'Share a preview link to this page with people without a login',
        )}
      >
        <i className="fas fa-fw fa-share-nodes" aria-hidden />
        <span className="hidden @[80rem]:inline">
          {t('share.button', 'Share')}
        </span>
      </Button>

      {open && (
        <ShareLinkDialog document={document} open={open} onOpenChange={setOpen} />
      )}
    </>
  )
}
