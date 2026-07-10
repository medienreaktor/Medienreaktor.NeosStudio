import type { Site } from '@/api/sites'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/**
 * Topbar dropdown selecting the active site; all site-scoped views (document
 * tree, content outliner) follow it. Sites without a node in the current
 * subgraph are listed but not selectable.
 */
export function SiteSwitcher({
  sites,
  value,
  onChange,
}: {
  sites: Site[]
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
      <SelectTrigger className="w-48" title="Active site" size="sm">
        <SelectValue placeholder="Select site…" />
      </SelectTrigger>
      <SelectContent>
        {sites.map((site) => (
          <SelectItem key={site.nodeName} value={site.nodeName} disabled={site.nodeAddress === null}>
            {site.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
