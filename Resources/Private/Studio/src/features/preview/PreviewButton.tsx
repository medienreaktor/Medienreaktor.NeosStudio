import { isDeleted, type NodeDto } from '@/api/nodes'
import { Button } from '@/components/ui/button'
import { translate as t } from '@/lib/i18n'
import { previewUrl } from './PreviewPane'

/** Window name of the preview tab, so one tab is reused instead of piling up. */
const PREVIEW_WINDOW_NAME = 'neos-studio-preview'

/**
 * Topbar button opening the selected document in a browser tab of its own. The
 * link always uses the plain "frontend" preview rendering - the page including
 * hidden content, without the content-element metadata of the shell's
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
export function PreviewButton({
  document,
  className,
}: {
  document: NodeDto
  /** E.g. the rounded-corner overrides of a split-button segment. */
  className?: string
}) {
  const label = t('preview.openInNewTab', 'Open page in a new tab')
  return (
    <Button
      asChild
      variant="secondary"
      size="icon"
      className={className}
      title={label}
      aria-label={label}
    >
      <a
        href={previewUrl(document.address, undefined, isDeleted(document))}
        target={PREVIEW_WINDOW_NAME}
      >
        <i className="fas fa-fw fa-arrow-up-right-from-square" aria-hidden />
      </a>
    </Button>
  )
}
