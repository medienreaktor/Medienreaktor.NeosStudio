import { useMemo, useState } from 'react'
import {
  useWorkspaceDocumentChanges,
  type Workspace,
  type WorkspaceDocumentChange,
} from '@/api/workspaces'
import { useStudio } from '@/app/StudioContext'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { LoadingState } from '@/components/ui/spinner'
import { Placeholder } from '@/components/ui/placeholder'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FaIcon } from '@/features/tree/nodeTypeIcon'
import { cn } from '@/lib/utils'
import { ConflictResolutionDialog } from './ConflictResolutionDialog'
import { useWorkspacePublishing } from './useWorkspacePublishing'

/** The change verbs a document row can carry, in display priority order. */
const CHANGE_BADGES = [
  { key: 'created', label: 'New', icon: 'fa-plus', className: 'bg-green-500' },
  {
    key: 'deleted',
    label: 'Removed',
    icon: 'fa-trash-can',
    className: 'bg-red-500',
  },
  {
    key: 'moved',
    label: 'Moved',
    icon: 'fa-arrows-up-down-left-right',
    className: 'bg-blue-500',
  },
  {
    key: 'changed',
    label: 'Changed',
    icon: 'fa-pen',
    className: 'bg-amber-500',
  },
] as const

function ChangeBadges({ document }: { document: WorkspaceDocumentChange }) {
  return (
    <span className="flex flex-wrap gap-1">
      {CHANGE_BADGES.filter((badge) => document[badge.key]).map((badge) => (
        <span
          key={badge.key}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white',
            badge.className,
          )}
        >
          <i
            className={`fas fa-fw ${badge.icon} text-[0.625rem]`}
            aria-hidden
          />
          {badge.label}
        </span>
      ))}
    </span>
  )
}

/**
 * Lists every change the active workspace has made on top of its base
 * workspace, grouped by the document (page) it belongs to, and lets an editor
 * publish or discard a selection of documents. Scoped to the active site, the
 * same way the Publish button's count is, so the two always agree.
 *
 * Granularity is the document: the content repository publishes/discards a
 * document's changes as a unit, which is what avoids the dependency conflicts
 * an arbitrary per-node selection would hit. A conflict against the base
 * surfaces the shared ConflictResolutionDialog.
 */
export function ReviewChangesDialog({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: Workspace
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const workspaceName = workspace.name
  const canPublish = workspace.permissions.publish
  const { site, navigateToNode } = useStudio()
  // Fetch only while open; the query refreshes on publish/discard via the
  // workspaces invalidation the shared hook performs.
  const { data, isLoading } = useWorkspaceDocumentChanges(workspaceName, open)
  const { operation, resolve, pendingConflict, setPendingConflict } =
    useWorkspacePublishing(workspaceName)

  // Scope to the active site, mirroring the Publish button: the active site's
  // documents plus any whose site could not be resolved (never silently hide a
  // pending change).
  const siteId = site?.aggregateId ?? null
  const documents = useMemo(() => {
    const all = data?.documents ?? []
    return siteId
      ? all.filter(
          (d) => d.siteAggregateId === siteId || d.siteAggregateId === null,
        )
      : all
  }, [data, siteId])

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // A discard waiting for confirmation; the confirm dialog is open while true.
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  // Validate the selection against the current list so a published/discarded
  // (now absent) document never lingers as a phantom selection.
  const selected = useMemo(
    () => documents.filter((d) => selectedIds.has(d.documentAggregateId)),
    [documents, selectedIds],
  )
  const selectedCount = selected.length
  const allSelected = documents.length > 0 && selectedCount === documents.length

  const toggle = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleAll = (checked: boolean) => {
    setSelectedIds(
      checked
        ? new Set(documents.map((d) => d.documentAggregateId))
        : new Set(),
    )
  }

  const run = (kind: 'publish' | 'discard') => {
    const ids = selected.map((d) => d.documentAggregateId)
    if (ids.length === 0) return
    operation.mutate(
      { kind, filter: { documents: ids } },
      { onSuccess: () => setSelectedIds(new Set()) },
    )
  }

  const busy = operation.isPending
  const publishDeniedHint = `You are not allowed to publish to "${workspace.baseWorkspace ?? 'the base workspace'}"`

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
        <DialogContent className="flex max-h-[85vh] w-full max-w-2xl flex-col">
          <DialogHeader>
            <DialogTitle>Review changes</DialogTitle>
            <DialogDescription>
              {`Changes on top of "${workspace.baseWorkspace ?? 'the base workspace'}". Select documents to publish or discard.`}
            </DialogDescription>
          </DialogHeader>

          {documents.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 border-b border-neutral-800 pb-2 text-sm text-neutral-300">
              <Checkbox
                checked={allSelected}
                indeterminate={selectedCount > 0 && !allSelected}
                onCheckedChange={toggleAll}
              />
              {selectedCount > 0
                ? `${selectedCount} of ${documents.length} selected`
                : `Select all (${documents.length})`}
            </label>
          )}

          <div className="-mx-1 flex-1 overflow-y-auto px-1">
            {isLoading ? (
              <LoadingState label="Loading changes…" className="py-8" />
            ) : documents.length === 0 ? (
              <Placeholder
                icon="fa-check"
                title="No pending changes."
                className="py-8"
              />
            ) : (
              <ul className="flex flex-col gap-px">
                {documents.map((document) => {
                  const id = document.documentAggregateId
                  const isSelected = selectedIds.has(id)
                  const breadcrumb = document.breadcrumb.slice(0, -1)
                  return (
                    <li key={id}>
                      <label
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-sm px-3 py-2 transition-colors',
                          isSelected
                            ? 'bg-neutral-800'
                            : 'hover:bg-neutral-900',
                        )}
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={isSelected}
                          onCheckedChange={(checked) => toggle(id, checked)}
                        />
                        <FaIcon
                          icon={document.icon ?? 'fa-file'}
                          className={cn(
                            'mt-0.5 shrink-0 text-neutral-400',
                            document.hidden && 'opacity-50',
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                'truncate text-sm text-neutral-100',
                                document.hidden && 'opacity-50',
                              )}
                            >
                              {document.label}
                            </span>
                            {document.hidden && (
                              <i
                                className="fas fa-eye-slash text-xs text-neutral-500"
                                title="Hidden"
                                aria-hidden
                              />
                            )}
                          </div>
                          {breadcrumb.length > 0 && (
                            <div className="truncate text-xs text-neutral-500">
                              {breadcrumb.join(' › ')}
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-2">
                            <ChangeBadges document={document} />
                            <span className="text-xs text-neutral-500">
                              {document.changeCount}{' '}
                              {document.changeCount === 1
                                ? 'change'
                                : 'changes'}
                            </span>
                          </div>
                        </div>
                        {document.documentAddress && (
                          <button
                            type="button"
                            className="mt-0.5 shrink-0 text-xs text-blue-400 hover:underline"
                            title="Go to page"
                            onClick={(event) => {
                              // Don't toggle the row's checkbox.
                              event.preventDefault()
                              onOpenChange(false)
                              navigateToNode(document.documentAddress!)
                            }}
                          >
                            <i
                              className="fas fa-fw fa-arrow-up-right-from-square"
                              aria-hidden
                            />
                          </button>
                        )}
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <DialogFooter className="border-t border-neutral-800 pt-4">
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Close
            </Button>
            <Button
              variant="destructive"
              disabled={selectedCount === 0 || busy}
              onClick={() => setConfirmDiscard(true)}
            >
              <i className="fas fa-fw fa-trash-can" aria-hidden />
              Discard selected
            </Button>
            <Button
              disabled={selectedCount === 0 || !canPublish || busy}
              title={canPublish ? undefined : publishDeniedHint}
              className={
                selectedCount > 0 && canPublish
                  ? 'bg-green-500 text-white hover:bg-green-600'
                  : undefined
              }
              onClick={() => run('publish')}
            >
              <i
                className={`fas fa-fw ${busy && operation.variables?.kind === 'publish' ? 'fa-spinner fa-spin' : 'fa-arrow-up-from-bracket'}`}
                aria-hidden
              />
              {selectedCount > 0
                ? `Publish selected (${selectedCount})`
                : 'Publish selected'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDiscard}
        onOpenChange={(next) => !next && setConfirmDiscard(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedCount === 1
                ? 'Discard changes on this document?'
                : `Discard changes on ${selectedCount} documents?`}
            </DialogTitle>
            <DialogDescription>
              The pending changes on the selected{' '}
              {selectedCount === 1 ? 'document' : 'documents'} will be
              discarded. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setConfirmDiscard(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDiscard(false)
                run('discard')
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConflictResolutionDialog
        open={pendingConflict !== null}
        conflicts={pendingConflict?.conflicts.conflicts ?? []}
        partial={
          pendingConflict?.conflicts.code === 'partial_publish_conflicts'
        }
        busy={resolve.isPending}
        onCancel={() => setPendingConflict(null)}
        onForce={() => resolve.mutate('force')}
        onDiscardAll={() => resolve.mutate('discardAll')}
        onNavigate={(address) => {
          setPendingConflict(null)
          onOpenChange(false)
          navigateToNode(address)
        }}
      />
    </>
  )
}
