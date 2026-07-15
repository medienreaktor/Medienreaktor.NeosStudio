import type { Site } from '@/api/sites'
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
      <SelectTrigger title="Active site">
        <div className="flex items-center gap-2">
          <i
            className={`fa fa-globe fa-fw text-[0.7rem] text-neutral-400`}
            aria-hidden
          />
          <SelectValue placeholder="Select site…" />
        </div>
      </SelectTrigger>
      <SelectContent>
        {sites.map((site) => (
          <SelectItem
            key={site.nodeName}
            value={site.nodeName}
            disabled={site.nodeAddress === null}
          >
            {site.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
