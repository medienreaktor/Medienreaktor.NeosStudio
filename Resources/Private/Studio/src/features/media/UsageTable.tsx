import { FileIcon } from 'lucide-react'

import { useAssetUsage } from '@/api/media'
import { Skeleton } from '@/components/ui/skeleton'

/** Where a given asset is referenced across the content repository. */
export function UsageTable({
  assetSource,
  identifier,
}: {
  assetSource: string
  identifier: string
}) {
  const usage = useAssetUsage(assetSource, identifier)

  if (usage.isLoading) {
    return <Skeleton className="h-16 w-full" />
  }
  if (usage.error || !usage.data) {
    return (
      <p className="text-xs text-neutral-500">
        Usage information is unavailable.
      </p>
    )
  }
  if (usage.data.total === 0) {
    return (
      <p className="text-xs text-neutral-500">
        Not used anywhere. Safe to delete.
      </p>
    )
  }

  return (
    <div className="space-y-1">
      {usage.data.usages.map((entry, index) => (
        <div
          key={index}
          className="flex items-center gap-2 rounded bg-neutral-800/50 px-2 py-1.5 text-xs"
        >
          <FileIcon className="size-3.5 shrink-0 text-neutral-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-neutral-200">
              {entry.documentNode?.label ?? entry.node.label}
            </p>
            {entry.documentNode &&
              entry.documentNode.label !== entry.node.label && (
                <p className="truncate text-neutral-500">{entry.node.label}</p>
              )}
          </div>
          <span className="shrink-0 text-neutral-500">
            {entry.workspaceName}
          </span>
        </div>
      ))}
      {usage.data.inaccessibleCount > 0 && (
        <p className="text-xs text-neutral-500">
          + {usage.data.inaccessibleCount} usage(s) you cannot access
        </p>
      )}
    </div>
  )
}
