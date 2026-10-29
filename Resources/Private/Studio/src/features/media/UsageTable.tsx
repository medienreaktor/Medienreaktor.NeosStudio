import { useAssetUsage } from '@/api/media'
import { translate as t } from '@/lib/i18n'
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
      <p className="type-small text-muted-foreground">
        {t('media.usageUnavailable', 'Usage information is unavailable.')}
      </p>
    )
  }
  if (usage.data.total === 0) {
    return (
      <p className="type-small text-muted-foreground">
        {t('media.usageNone', 'Not used anywhere. Safe to delete.')}
      </p>
    )
  }

  return (
    <div className="space-y-1">
      {usage.data.usages.map((entry, index) => (
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
            {entry.workspaceName}
          </span>
        </div>
      ))}
      {usage.data.inaccessibleCount > 0 && (
        <p className="type-small text-muted-foreground">
          {t('media.usageInaccessible', '+ {0} usage(s) you cannot access', [
            usage.data.inaccessibleCount,
          ])}
        </p>
      )}
    </div>
  )
}
