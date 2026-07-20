import { CopyIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import type { InspectorViewComponent } from './registry'

export const NODE_INFO_VIEW = 'Neos.Neos/Inspector/Views/NodeInfoView'

/**
 * The classic UI's node metadata widget (Neos.Neos:Document ships it in the
 * document group): creation and modification timestamps, identifier, address
 * and type of the inspected node. Values select on click for easy copying;
 * the node type has a dedicated copy button like the original.
 */
export const NodeInfoView: InspectorViewComponent = ({ node }) => {
  const dateText = (value: string | null | undefined): string =>
    value ? new Date(value).toLocaleString() : 'unavailable'

  const copyNodeType = () => {
    navigator.clipboard.writeText(node.nodeType).then(
      () => toast.success('Copied node type to clipboard'),
      () => toast.error('Could not copy to clipboard'),
    )
  }

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
      <InfoRow label="Created">{dateText(node.timestamps.created)}</InfoRow>
      <InfoRow label="Last modification">
        {dateText(node.timestamps.lastModified)}
      </InfoRow>
      <InfoRow label="Identifier">{node.aggregateId}</InfoRow>
      <InfoRow label="Node address">{node.address}</InfoRow>
      {node.name && <InfoRow label="Name">{node.name}</InfoRow>}
      <InfoRow label="Type">
        <span className="flex items-start gap-1">
          <span className="min-w-0 break-all">{node.nodeType}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title="Copy node type to clipboard"
            aria-label="Copy node type to clipboard"
            className="-my-1 shrink-0"
            onClick={copyNodeType}
          >
            <CopyIcon />
          </Button>
        </span>
      </InfoRow>
    </dl>
  )
}

function InfoRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <>
      <dt className="text-neutral-400">{label}</dt>
      <dd
        className="min-w-0 cursor-pointer break-all text-white select-all"
        title="Click to select"
      >
        {children}
      </dd>
    </>
  )
}
