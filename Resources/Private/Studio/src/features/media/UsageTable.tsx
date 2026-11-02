import { useAssetUsages } from '@/api/neos/endpoints/assets'
import { translate as t, translatePlural as tp } from '@/lib/i18n'
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
    return <Skeleton className="h-15 w-full" />
  }
  if (usage.error || !usage.data) {
    return (
      <p className="type-small text-muted-foreground">
        {t('media.usageUnavailable', 'Usage information is unavailable.')}
      </p>
    )
  }
  if (usage.data.meta.total === 0 && usage.data.meta.inaccessible === 0) {
    return (
      <p className="type-small text-muted-foreground">
        {t('media.usageNone', 'Not used anywhere. Safe to delete.')}
      </p>
    )
  }

  return (
    <div className="space-y-1">
      {usage.data.data.map((entry, index) => (
        <div
          key={index}
          className="flex items-center gap-2 rounded bg-muted/50 px-2 py-1.5 type-small"
        >
          <i
            className="fas fa-file type-icon-l shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-foreground">
              {entry.documentNode?.label ?? entry.node.label}
            </p>
            {entry.documentNode &&
              entry.documentNode.label !== entry.node.label && (
                <p className="truncate text-muted-foreground">
                  {entry.node.label}
                </p>
              )}
          </div>
          <span className="shrink-0 text-muted-foreground">
            {entry.node.workspaceName}
          </span>
        </div>
      ))}
      {usage.data.meta.inaccessible > 0 && (
        <p className="type-small text-muted-foreground">
          {tp('media.usageInaccessible', usage.data.meta.inaccessible, [
            '+ {0} usage you cannot access',
            '+ {0} usages you cannot access',
          ])}
        </p>
      )}
    </div>
  )
}
