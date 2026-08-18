import { isDeleted, type NodeDto } from '@/api/nodes'
import { Button } from '@/components/ui/button'
import { translate as t } from '@/lib/i18n'
import { previewUrl } from './PreviewPane'

/**
 * Topbar button opening the selected document in a new browser tab. The link
 * always uses the plain "frontend" preview rendering - the page exactly as
 * visitors would see it, without the content-element metadata of the shell's
 * "inPlace" iframe. The node address already pins the active workspace and
 * dimension, so the new tab shows the state currently being edited.
 */
export function PreviewButton({ document }: { document: NodeDto }) {
  return (
    <Button
      asChild
      variant="secondary"
      title={t('preview.openInNewTab', 'Open page in a new tab')}
    >
      <a
        href={previewUrl(document.address, undefined, isDeleted(document))}
        target="_blank"
        rel="noreferrer"
      >
        <i className="fas fa-fw fa-arrow-up-right-from-square" aria-hidden />
        <span className="hidden @[64rem]:inline">
          {t('preview.button', 'Preview')}
        </span>
      </a>
    </Button>
  )
}
