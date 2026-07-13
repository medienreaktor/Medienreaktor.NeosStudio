import { useMutation } from '@tanstack/react-query'
import { publishWorkspace, useWorkspaceChanges } from '@/api/workspaces'
import { queryKeys } from '@/api/keys'
import { queryClient } from '@/app/queryClient'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Topbar button publishing all pending changes of the active workspace to its
 * base. Orange with a change-count bubble while there is something to publish,
 * muted and disabled otherwise.
 */
export function PublishButton({ workspaceName, onPublished }: { workspaceName: string; onPublished?: () => void }) {
  // Same query the trees' dirty markers use, so button and badges agree.
  const { data: changesResponse } = useWorkspaceChanges(workspaceName)
  const changeCount = changesResponse?.changes.length ?? 0

  const publish = useMutation({
    mutationFn: () => publishWorkspace(workspaceName),
    onSuccess: () => {
      // Covers the changes query (this bubble, tree badges) and the workspace
      // list's hasPublishableChanges flag.
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
      onPublished?.()
    },
  })

  const hasChanges = changeCount > 0

  return (
    <div className="flex items-center gap-3">
      {publish.isError && <span className="text-sm text-destructive">Publishing failed</span>}
      <Button
        className={cn('relative', hasChanges && 'bg-orange-500 text-white hover:bg-orange-600')}
        variant={hasChanges ? 'default' : 'secondary'}
        disabled={!hasChanges || publish.isPending}
        onClick={() => publish.mutate()}
        title={hasChanges ? `Publish ${changeCount} pending ${changeCount === 1 ? 'change' : 'changes'}` : 'No pending changes'}
      >
        <i className={`fas fa-fw ${publish.isPending ? 'fa-spinner fa-spin' : 'fa-arrow-up-from-bracket'}`} aria-hidden />
        Publish
        {hasChanges && (
          <span
            className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full border border-orange-500 bg-background px-1 text-xs font-semibold text-orange-600 tabular-nums"
            aria-label={`${changeCount} pending changes`}
          >
            {changeCount}
          </span>
        )}
      </Button>
    </div>
  )
}
