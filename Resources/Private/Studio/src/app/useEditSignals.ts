import { useState } from 'react'
import type { NodeAddress } from '@/api/neos/schema'
import type { PreviewElementUpdate } from '@/features/preview/PreviewPane'
import type { NodeEdit } from '@/features/tree/ContentOutliner'
import { ALL_NODES } from '@/features/tree/useNodeEditRefresh'

/**
 * The signals the shell hands to the trees and the preview after an edit -
 * each a token-bumped value, so a repeat of the same edit is a new signal.
 */
export function useEditSignals() {
  // The last edit; refreshes the trees' rows (outliner labels and the like).
  const [lastEdit, setLastEdit] = useState<NodeEdit | null>(null)
  // Bumped after edits made outside of the preview so it shows them (inline
  // edits already render live inside the iframe and need no reload).
  const [previewReloadToken, setPreviewReloadToken] = useState(0)
  // Inspector edits of ui.reloadIfChanged properties (and remote
  // collaborators' content edits): refresh just those nodes' elements in the
  // preview (out-of-band render) instead of a full reload.
  const [previewElementUpdate, setPreviewElementUpdate] =
    useState<PreviewElementUpdate | null>(null)

  return {
    lastEdit,
    previewReloadToken,
    previewElementUpdate,
    /** Refresh these nodes in the trees - ALL_NODES for every one. */
    reportEdit: (addresses: (NodeAddress | typeof ALL_NODES)[]) =>
      setLastEdit((previous) => ({
        addresses,
        token: (previous?.token ?? 0) + 1,
      })),
    /** Reload the preview iframe. */
    reloadPreview: () => setPreviewReloadToken((token) => token + 1),
    /** Re-render these nodes' elements in the preview, out-of-band. */
    updatePreviewElements: (addresses: NodeAddress[], remote = false) =>
      setPreviewElementUpdate((previous) => ({
        addresses,
        token: (previous?.token ?? 0) + 1,
        ...(remote ? { remote } : {}),
      })),
  }
}
