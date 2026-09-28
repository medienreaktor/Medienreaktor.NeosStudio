import { isDeleted, type NodeDto } from '@/api/nodes'
import { Button } from '@/components/ui/button'
import { translate as t } from '@/lib/i18n'
import { previewUrl } from './PreviewPane'

/** Window name of the preview tab, so one tab is reused instead of piling up. */
const PREVIEW_WINDOW_NAME = 'neos-studio-preview'

/**
 * Topbar button opening the selected document in a browser tab of its own. The
 * link always uses the plain "frontend" preview rendering - the page exactly as
 * visitors would see it, without the content-element metadata of the shell's
 * "inPlace" iframe. The node address already pins the active workspace and
 * dimension, so the tab shows the state currently being edited.
 *
 * The target is a fixed window name rather than "_blank": previewing a second
 * document reuses and refreshes the tab that is already open, the way the
 * classic Neos UI behaved. That rules out "rel=noreferrer" - it implies
 * "noopener", which makes the browser pick a fresh context and ignore the name.
 * Nothing is lost by dropping it: the preview is same-origin with the shell, so
 * there is no cross-origin referrer to withhold.
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
        target={PREVIEW_WINDOW_NAME}
      >
        <i className="fas fa-fw fa-arrow-up-right-from-square" aria-hidden />
        <span className="hidden @[80rem]:inline">
          {t('preview.button', 'Preview')}
        </span>
      </a>
    </Button>
  )
}
