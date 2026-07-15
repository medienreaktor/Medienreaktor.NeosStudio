import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  discardWorkspace,
  publishWorkspace,
  useWorkspaceChanges,
  type Workspace,
  type WorkspaceOperationFilter,
} from '@/api/workspaces'
import { queryKeys } from '@/api/keys'
import { queryClient } from '@/app/queryClient'
import { useStudio } from '@/app/StudioContext'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface Operation {
  kind: 'publish' | 'discard'
  /** Scope; omitted = the whole workspace. */
  filter?: WorkspaceOperationFilter
}

/**
 * Topbar split button for the active workspace: primary action publishes all
 * pending changes to the base workspace, the attached dropdown scopes to the
 * selected document ("this page") and offers discarding (behind a
 * confirmation - discards are irreversible). Orange with a change-count
 * bubble while there is something to publish, muted and disabled otherwise.
 * Without publish permission on the base workspace (a non-LivePublisher
 * editor) the publish actions are disabled with an explanation - discarding
 * stays available, it only touches the own workspace.
 */
export function PublishButton({ workspace }: { workspace: Workspace }) {
  const workspaceName = workspace.name
  const canPublish = workspace.permissions.publish
  // Same query the trees' dirty markers use, so button and badges agree.
  const { data: changesResponse } = useWorkspaceChanges(workspaceName)
  const { selectedDocument, workspaceContentChanged } = useStudio()
  // A discard waiting for confirmation; the dialog is open while set.
  const [pendingDiscard, setPendingDiscard] = useState<Operation | null>(null)

  const changes = changesResponse?.changes ?? []
  const changeCount = changes.length
  const documentId = selectedDocument?.aggregateId ?? null
  // "This page" = changes on or within the selected document.
  const pageChangeCount = documentId
    ? changes.filter(
        (c) =>
          c.documentAggregateId === documentId ||
          c.nodeAggregateId === documentId,
      ).length
    : 0

  const operation = useMutation({
    mutationFn: async (op: Operation): Promise<void> => {
      if (op.kind === 'publish')
        await publishWorkspace(workspaceName, op.filter)
      else await discardWorkspace(workspaceName, op.filter)
    },
    onSuccess: () => {
      // Covers the changes query (this bubble, tree badges) and the workspace
      // list's hasPublishableChanges flag.
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
      // Publishing rebases the workspace onto the new base (changes published
      // by others flow in) and discarding rewrites its content - cached node
      // reads are stale either way, and every loaded tree item needs a
      // re-read (per-item caches in the trees never expire on their own).
      void queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
      workspaceContentChanged()
    },
  })

  const hasChanges = changeCount > 0
  // Only invite the click when it can succeed: orange needs changes AND
  // publish permission on the base workspace.
  const segmentClasses =
    hasChanges && canPublish
      ? 'bg-green-500 text-white hover:bg-green-600'
      : undefined
  const segmentVariant =
    hasChanges && canPublish ? ('default' as const) : ('secondary' as const)
  const publishDeniedHint = `You are not allowed to publish to "${workspace.baseWorkspace ?? 'the base workspace'}"`

  return (
    <div className="flex items-center gap-3">
      {operation.isError && (
        <span className="text-sm text-red-500">
          {operation.variables?.kind === 'discard'
            ? 'Discarding failed'
            : 'Publishing failed'}
        </span>
      )}
      {/* gap-px splits the segments with a hairline of header background */}
      <div className="relative flex gap-px">
        <Button
          className={cn('rounded-r-none', segmentClasses)}
          variant={segmentVariant}
          disabled={!hasChanges || !canPublish || operation.isPending}
          onClick={() => operation.mutate({ kind: 'publish' })}
          title={
            !canPublish
              ? publishDeniedHint
              : hasChanges
                ? `Publish ${changeCount} pending ${changeCount === 1 ? 'change' : 'changes'}`
                : 'No pending changes'
          }
        >
          <i
            className={`fas fa-fw ${operation.isPending ? 'fa-spinner fa-spin' : 'fa-arrow-up-from-bracket'}`}
            aria-hidden
          />
          Publish all changes
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                className={cn('rounded-l-none px-2', segmentClasses)}
                variant={segmentVariant}
                disabled={!hasChanges || operation.isPending}
                aria-label="More publish and discard actions"
              />
            }
          >
            <i className="fas fa-chevron-down text-xs" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={pageChangeCount === 0 || !canPublish}
              title={canPublish ? undefined : publishDeniedHint}
              onClick={() =>
                operation.mutate({
                  kind: 'publish',
                  filter: { document: documentId! },
                })
              }
            >
              <i className="fas fa-fw fa-file-arrow-up" aria-hidden />
              Publish this page
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={!hasChanges}
              onClick={() => setPendingDiscard({ kind: 'discard' })}
            >
              <i className="fas fa-fw fa-trash-can" aria-hidden />
              Discard all
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={pageChangeCount === 0}
              onClick={() =>
                setPendingDiscard({
                  kind: 'discard',
                  filter: { document: documentId! },
                })
              }
            >
              <i className="fas fa-fw fa-trash-can" aria-hidden />
              Discard
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {hasChanges && (
          <span
            className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-semibold text-white tabular-nums"
            aria-label={`${changeCount} pending changes`}
          >
            {changeCount}
          </span>
        )}
      </div>

      <Dialog
        open={pendingDiscard !== null}
        onOpenChange={(open) => !open && setPendingDiscard(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingDiscard?.filter?.document
                ? 'Discard changes on this page?'
                : 'Discard all changes?'}
            </DialogTitle>
            <DialogDescription>
              {pendingDiscard?.filter?.document
                ? `${pageChangeCount} pending ${pageChangeCount === 1 ? 'change' : 'changes'} on this page will be discarded.`
                : `All ${changeCount} pending ${changeCount === 1 ? 'change' : 'changes'} in this workspace will be discarded.`}{' '}
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPendingDiscard(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDiscard) operation.mutate(pendingDiscard)
                setPendingDiscard(null)
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
