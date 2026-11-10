import { DOCUMENT_NODE_TYPE } from '@/api/neos/endpoints/nodes'
import { isOfType, type NodeTypeMap } from '@/api/neos/endpoints/nodeTypes'
import { faClassName } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

export function resolveNodeTypeIconClass(
  map: NodeTypeMap | undefined,
  nodeTypeName: string,
): string {
  const configured = map?.get(nodeTypeName)?.icon
  if (configured) return faClassName(configured)
  if (map && isOfType(map, nodeTypeName, DOCUMENT_NODE_TYPE))
    return 'fas fa-file'
  if (map && isOfType(map, nodeTypeName, 'Neos.Neos:ContentCollection'))
    return 'fas fa-folder'
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
      className={cn(
        resolveNodeTypeIconClass(nodeTypes, nodeTypeName),
        'fa-fw type-icon-m',
        className,
      )}
      aria-hidden
    />
  )
}
