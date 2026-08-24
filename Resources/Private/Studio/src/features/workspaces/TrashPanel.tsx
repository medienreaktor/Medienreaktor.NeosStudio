import { useMemo, useState } from 'react'
import { fetchNode } from '@/api/nodes'
import {
  useWorkspaces,
  useWorkspaceTrash,
  type WorkspaceTrashItem,
} from '@/api/workspaces'
import { useStudio } from '@/app/StudioContext'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Placeholder } from '@/components/ui/placeholder'
import { LoadingState } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { FaIcon } from '@/features/tree/nodeTypeIcon'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { relativeTime } from './historyLabels'
import { useTrashRestore } from './useTrashRestore'

/**
 * The Trash panel: the pages deleted in the workspace being edited, newest
 * first, each restorable.
 *
 * Deleting a node is a soft removal - it stays in the content repository,
 * tagged "removed", and only the publish of that deletion lets the repository
 * erase it in live. Everything between those two moments is what this panel
 * shows: content that is gone from the trees and the page, but recoverable.
 * Restoring is the exact inverse (the tag is dropped again), so it costs
 * nothing and needs no confirmation - except when deleted ancestors come back
 * with the page, which is worth saying out loud first.
 *
 * Pages only: deleted content ELEMENTS are restored where they are edited, so
 * the resource is asked for the documents alone rather than filtered here.
 */
export function TrashPanel() {
  const { site, workspaceName, selectedDocument, selectDocument } = useStudio()
  const { data, isLoading, isError } = useWorkspaceTrash(workspaceName)
  const { data: workspaces } = useWorkspaces()
  // A page whose restore would bring deleted ancestors along - confirmed first.
  const [pendingRestore, setPendingRestore] =
    useState<WorkspaceTrashItem | null>(null)

  const canWrite =
    workspaces?.workspaces.find((workspace) => workspace.name === workspaceName)
      ?.permissions.write ?? false
  const outdated = data?.status === 'OUTDATED'

  // Scoped to the active site like the review dialog, including entries whose
  // site could not be resolved - never silently hide a deleted page.
  const siteId = site?.aggregateId ?? null
  const items = useMemo(() => {
    const all = data?.items ?? []
    return all.filter(
      (item) =>
        siteId === null ||
        item.siteAggregateId === siteId ||
        item.siteAggregateId === null,
    )
  }, [data, siteId])

  const restore = useTrashRestore(workspaceName)

  // Open a deleted page in the shell: it reads (and renders) only through the
  // deleted-node opt-in, which every consumer derives from the node's own
  // "removed" tag - so the fetch is all it takes.
  const select = (item: WorkspaceTrashItem) => {
    if (item.nodeAddress === null) return
    fetchNode(item.nodeAddress, undefined, true)
      .then(selectDocument)
      .catch((error: unknown) =>
        toast.error(error, {
          title: t('trash.openFailed', 'Opening the deleted page failed'),
        }),
      )
  }

  const runRestore = (item: WorkspaceTrashItem) => {
    if (item.restoresAncestors.length > 0) {
      setPendingRestore(item)
      return
    }
    restore.mutate({ nodeAggregateId: item.nodeAggregateId, label: item.label })
  }

  if (!workspaceName || isLoading) {
    return <LoadingState label={t('trash.loading', 'Loading trash…')} />
  }
  if (isError) {
    return (
      <Placeholder
        icon="fa-triangle-exclamation"
        title={t('trash.failed', 'The trash could not be loaded.')}
      />
    )
  }

  // Nothing to list: the placeholder brings its own padding and fills the
  // panel, so it stands alone rather than inside the list's padded column.
  // Nothing else belongs here either - the outdated warning is about restoring
  // and a restore can only be pending for a row.
  if (items.length === 0) {
    return (
      <Placeholder
        icon="fa-trash-can"
        title={t(
          'trash.empty',
          'No deleted pages. They wait here until the deletion is published.',
        )}
      >
        {data?.truncated && (
          <p className="text-xs text-neutral-500">
            {t(
              'trash.truncated',
              'Only the most recently deleted nodes are listed.',
            )}
          </p>
        )}
      </Placeholder>
    )
  }

  return (
    <div className="flex flex-col gap-1 p-3">
      {outdated && (
        <p className="mb-1 rounded-sm bg-neutral-200 dark:bg-neutral-800 px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400">
          <i className="fas fa-fw fa-triangle-exclamation" aria-hidden />{' '}
          {t(
            'trash.outdated',
            'Synchronize the workspace before restoring - it is missing changes from its base workspace.',
          )}
        </p>
      )}
      {items.map((item) => (
        <TrashRow
          key={item.nodeAggregateId}
          item={item}
          selected={selectedDocument?.aggregateId === item.nodeAggregateId}
          onSelect={() => select(item)}
          disabled={!canWrite || outdated || restore.isPending}
          restoring={
            restore.isPending &&
            restore.variables.nodeAggregateId === item.nodeAggregateId
          }
          deniedHint={
            canWrite
              ? undefined
              : t(
                  'trash.noWriteAccess',
                  'You are not allowed to change this workspace',
                )
          }
          onRestore={() => runRestore(item)}
        />
      ))}
      {data?.truncated && (
        <p className="mt-1 text-xs text-neutral-500">
          {t(
            'trash.truncated',
            'Only the most recently deleted nodes are listed.',
          )}
        </p>
      )}

      <ConfirmDialog
        open={pendingRestore !== null}
        title={t('trash.confirmTitle', 'Restore "{0}"?', [
          pendingRestore?.label ?? '',
        ])}
        description={t(
          'trash.confirmBody',
          'It was deleted inside something that is deleted as well, so this also restores: {0}',
          [
            (pendingRestore?.restoresAncestors ?? [])
              .map((ancestor) => ancestor.label ?? ancestor.nodeAggregateId)
              .join(', '),
          ],
        )}
        confirmLabel={t('trash.restore', 'Restore')}
        destructive={false}
        onOpenChange={(open) => !open && setPendingRestore(null)}
        // Fire and close: the row shows the pending state and a failure is
        // reported by the mutation's own toast - awaiting here would toast twice.
        onConfirm={() => {
          if (pendingRestore)
            restore.mutate({
              nodeAggregateId: pendingRestore.nodeAggregateId,
              label: pendingRestore.label,
            })
          setPendingRestore(null)
        }}
      />
    </div>
  )
}

function TrashRow({
  item,
  selected,
  disabled,
  restoring,
  deniedHint,
  onSelect,
  onRestore,
}: {
  item: WorkspaceTrashItem
  selected: boolean
  disabled: boolean
  restoring: boolean
  deniedHint?: string
  onSelect: () => void
  onRestore: () => void
}) {
  // The breadcrumb ends with the deleted page itself - its location is the rest.
  const location = item.breadcrumb.slice(0, -1).join(' › ')
  const when = item.deletedAt ? relativeTime(item.deletedAt) : null
  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-sm border border-transparent pr-1',
        selected ? 'border-blue-500 bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-200 dark:hover:bg-neutral-800',
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left"
        disabled={item.nodeAddress === null}
        // Opening it shows the deleted page in the preview; who deleted it and
        // when rides along here instead of taking up a line of its own.
        title={[
          item.nodeAddress !== null
            ? t('trash.openHint', 'Show this deleted page')
            : null,
          when !== null && item.deletedBy !== null
            ? t('trash.deletedByAt', 'Deleted {0} by {1}', [
                when,
                item.deletedBy,
              ])
            : when !== null
              ? t('trash.deletedAt', 'Deleted {0}', [when])
              : null,
        ]
          .filter((line): line is string => line !== null)
          .join('\n')}
        onClick={onSelect}
      >
        <span className="shrink-0 text-neutral-950 dark:text-white">
          <FaIcon icon={item.icon ?? 'fa-file'} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block overflow-hidden text-sm text-ellipsis whitespace-nowrap">
            {item.label}
          </span>
          <span className="block overflow-hidden text-xs text-ellipsis whitespace-nowrap text-neutral-600 dark:text-neutral-400">
            {location}
          </span>
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        className={cn(
          // White at rest, green under the pointer: restoring is the one
          // additive action here, but it should not shout from every row.
          'shrink-0 text-neutral-950 dark:text-white hover:text-green-600 dark:hover:text-green-400',
          // Revealed on hover like the clipboard's row action; a running or
          // unavailable restore stays visible so its state can be seen.
          !restoring &&
            !disabled &&
            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        )}
        disabled={disabled}
        title={deniedHint ?? t('trash.restore', 'Restore')}
        onClick={onRestore}
      >
        <i
          className={cn(
            'fas',
            restoring ? 'fa-spinner fa-spin' : 'fa-clock-rotate-left',
          )}
          aria-hidden
        />
      </Button>
    </div>
  )
}
