import { useAssetUsages } from '@/api/neos/endpoints/assets'
import { translate as t } from '@/lib/i18n'
import { Skeleton } from '@/components/ui/skeleton'

/** Where a given asset is referenced across the content repository. */
export function UsageTable({
  assetSourceId,
  assetId,
}: {
  assetSourceId: string
  assetId: string
}) {
  const usage = useAssetUsages(assetSourceId, assetId)

  if (usage.isLoading) {
    return <Skeleton className="h-16 w-full" />
  }
  if (usage.error || !usage.data) {
    return (
      <p className="text-xs text-neutral-500">
        {t('media.usageUnavailable', 'Usage information is unavailable.')}
      </p>
    )
  }
  if (usage.data.meta.total === 0 && usage.data.meta.inaccessible === 0) {
    return (
      <p className="text-xs text-neutral-500">
        {t('media.usageNone', 'Not used anywhere. Safe to delete.')}
      </p>
    )
  }

  return (
    <div className="space-y-1">
      {usage.data.data.map((entry, index) => (
        <div
          key={index}
          className="flex items-center gap-2 rounded bg-neutral-200/50 dark:bg-neutral-800/50 px-2 py-1.5 text-xs"
        >
          <i
            className="fas fa-file text-[0.875rem] shrink-0 text-neutral-500"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-neutral-800 dark:text-neutral-200">
              {entry.documentNode?.label ?? entry.node.label}
            </p>
            {entry.documentNode &&
              entry.documentNode.label !== entry.node.label && (
                <p className="truncate text-neutral-500">{entry.node.label}</p>
              )}
          </div>
          <span className="shrink-0 text-neutral-500">
            {entry.node.workspaceName}
          </span>
        </div>
      ))}
      {usage.data.meta.inaccessible > 0 && (
        <p className="text-xs text-neutral-500">
          {t('media.usageInaccessible', '+ {0} usage(s) you cannot access', [
            usage.data.meta.inaccessible,
          ])}
        </p>
      )}
    </div>
  )
}
