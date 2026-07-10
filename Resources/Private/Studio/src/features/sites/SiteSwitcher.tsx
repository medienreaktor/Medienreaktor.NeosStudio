import type { Site } from '@/api/sites'

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
    <select
      className="site-switcher"
      title="Active site"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    >
      {sites.map((site) => (
        <option key={site.nodeName} value={site.nodeName} disabled={site.nodeAddress === null}>
          {site.name}
        </option>
      ))}
    </select>
  )
}
