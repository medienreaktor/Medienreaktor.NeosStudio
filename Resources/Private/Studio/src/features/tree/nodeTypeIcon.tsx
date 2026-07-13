import { isOfType, type NodeTypeMap } from '@/api/nodeTypes'
import { DOCUMENT_NODE_TYPE } from '@/api/nodes'
import { cn } from '@/lib/utils'

/**
 * Neos configures ui.icon as Font Awesome names; Studio ships the FA free
 * webfonts (solid + regular + v4 shims, imported in main.tsx), so configured
 * names render verbatim - including project-specific node type icons we
 * could never enumerate in a mapping table.
 */
export function faClassName(configured: string): string {
  const icon = configured.trim()
  // Full FA class list ("fas fa-file", "fa-solid fa-file") - use as-is.
  if (icon.includes(' ')) return icon
  // Legacy Neos "icon-file" syntax (FA3/4 era) - the v4 shims resolve names.
  if (icon.startsWith('icon-')) return `fa fa-${icon.slice(5)}`
  // Bare name with or without fa- prefix.
  return icon.startsWith('fa-') ? `fas ${icon}` : `fas fa-${icon}`
}

/** A Font Awesome icon from a configured name (node type, tab, select value...). */
export function FaIcon({ icon, className }: { icon: string; className?: string }) {
  return <i className={cn(faClassName(icon), 'fa-fw text-[0.75rem]', className)} aria-hidden />
}

export function resolveNodeTypeIconClass(map: NodeTypeMap | undefined, nodeTypeName: string): string {
  const configured = map?.get(nodeTypeName)?.icon
  if (configured) return faClassName(configured)
  if (map && isOfType(map, nodeTypeName, DOCUMENT_NODE_TYPE)) return 'fas fa-file'
  if (map && isOfType(map, nodeTypeName, 'Neos.Neos:ContentCollection')) return 'fas fa-folder'
  return 'fas fa-cube'
}

export function NodeTypeIcon({
  nodeTypes,
  nodeTypeName,
  className,
}: {
  nodeTypes: NodeTypeMap | undefined
  nodeTypeName: string
  className?: string
}) {
  return (
    <i
      className={cn(resolveNodeTypeIconClass(nodeTypes, nodeTypeName), 'fa-fw text-[0.75rem]', className)}
      aria-hidden
    />
  )
}
