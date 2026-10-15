import { useMutation } from '@tanstack/react-query'
import { fetchNode } from '@/api/neos/endpoints/nodes'
import { neosKeys } from '@/api/neos/keys'
import { restoreFromTrash } from '@/api/studio/endpoints/workspaces'
import { queryClient } from '@/app/queryClient'
import { useStudio } from '@/app/StudioContext'
import { toast } from '@/components/ui/toast'
import { invalidateWorkspaceQueries } from '@/features/workspaces/invalidate'
import { translate as t } from '@/lib/i18n'

/** What the caller knows about the node it restores - enough to report it. */
export interface RestorableNode {
  nodeAggregateId: string
  label: string
}

/**
 * Restoring a deleted node, shared by the Trash panel and the banner over a
 * deleted page in the preview: one mutation, so both refresh the same caches
 * and report the same way.
 *
 * A restore puts the node back into the workspace's content, so every cached
 * node read, tree item and the preview have to re-read. When the restored node
 * is the document currently open, its snapshot is refreshed too - the shell
 * holds a node still tagged "removed" otherwise, and would keep treating the
 * page as deleted.
 */
export function useTrashRestore(workspaceName: string | null) {
  const { selectedDocument, selectDocument, workspaceContentChanged } =
    useStudio()

  return useMutation({
    mutationFn: (node: RestorableNode) =>
      restoreFromTrash(workspaceName!, node.nodeAggregateId),
    onSuccess: (restored, node) => {
      void invalidateWorkspaceQueries()
      void queryClient.invalidateQueries({ queryKey: neosKeys.nodes.all })
      workspaceContentChanged()
      if (
        selectedDocument !== null &&
        selectedDocument.nodeAggregateId === node.nodeAggregateId
      ) {
        // Re-read the open document: it is no longer deleted, which changes how
        // the whole shell treats it (rendering mode, editability, the banner).
        fetchNode(selectedDocument)
          .then(selectDocument)
          .catch(() => {
            /* the workspace-wide refresh above already re-reads it */
          })
      }
      const label = restored[0]?.label ?? node.label
      toast.success(
        restored.length > 1
          ? t('trash.restoredWithAncestors', 'Restored {0} and {1} more.', [
              label,
              String(restored.length - 1),
            ])
          : t('trash.restored', 'Restored {0}.', [label]),
      )
    },
    onError: (error) =>
      toast.error(error, {
        title: t('trash.restoreFailed', 'Restoring failed'),
      }),
  })
}
