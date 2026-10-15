import { isNotFound } from '@/api/http/errors'
import { useNode } from '@/api/neos/endpoints/nodes'
import { siteNodeAddress } from '@/api/neos/endpoints/sites'
import type { Site } from '@/api/neos/schema'
import { translate as t } from '@/lib/i18n'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * Topbar dropdown selecting the active site; all site-scoped views (document
 * tree, content outliner) follow it. Sites without a node in the current
 * workspace and dimension space point (the site node read is a 404) are listed
 * but not selectable - the usual cause is a site created after this workspace
 * was forked from live, which a synchronize (rebase) pulls in, so the entry
 * says so.
 */
export function SiteSwitcher({
  sites,
  workspaceName,
  dimensionSpacePoint,
  value,
  onChange,
}: {
  sites: Site[]
  /** The workspace the shell edits - where the site nodes are looked up. */
  workspaceName: string
  /** The dimension space point (JSON) the shell edits in. */
  dimensionSpacePoint: string
  /** nodeName of the active site */
  value: string | null
  onChange: (nodeName: string) => void
}) {
  return (
    <Select
      value={value ?? undefined}
      onValueChange={(v) => onChange(v as string)}
      // Lets SelectValue render the site name for the selected nodeName.
      items={sites.map((site) => ({ value: site.nodeName, label: site.name }))}
    >
      <SelectTrigger title={t('sites.activeSite', 'Active site')}>
        <div className="flex items-center gap-2">
          <i
            className={`fa fa-globe fa-fw text-[0.7rem] text-neutral-600 dark:text-neutral-400`}
            aria-hidden
          />
          <SelectValue
            className="hidden @[80rem]:inline"
            placeholder={t('sites.selectPlaceholder', 'Select site…')}
          />
        </div>
      </SelectTrigger>
      <SelectContent>
        {sites.map((site) => (
          <SiteOption
            key={site.nodeName}
            site={site}
            workspaceName={workspaceName}
            dimensionSpacePoint={dimensionSpacePoint}
          />
        ))}
      </SelectContent>
    </Select>
  )
}

function SiteOption({
  site,
  workspaceName,
  dimensionSpacePoint,
}: {
  site: Site
  workspaceName: string
  dimensionSpacePoint: string
}) {
  const address = siteNodeAddress(site, workspaceName, dimensionSpacePoint)
  // The same read the tree makes of the active site's node, so it is shared.
  const siteNode = useNode(address)
  const missing = address === null || isNotFound(siteNode.error)
  return (
    <SelectItem value={site.nodeName} disabled={missing}>
      {site.name}
      {missing && (
        <span className="ml-1.5 text-xs text-neutral-500">
          {t('sites.synchronizeToAccess', '(synchronize to access)')}
        </span>
      )}
    </SelectItem>
  )
}
