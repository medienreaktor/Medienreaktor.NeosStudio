import { useEffect, useState } from 'react'
import { type Command, executeCommands } from '@/api/commands'
import type { ContentDimension, DimensionSpacePoint } from '@/api/dimensions'
import { dimensionSpacePointEquals } from '@/api/dimensions'
import {
  DOCUMENT_NODE_TYPE,
  fetchAncestors,
  fetchChildren,
  fetchNodeVariants,
  type NodeDto,
  nodeLabel,
} from '@/api/nodes'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** "English (US)" or "English (US), Customers" for multiple dimensions. */
function pointLabel(
  point: DimensionSpacePoint,
  dimensions: ContentDimension[],
): string {
  return dimensions
    .map(
      (dimension) =>
        dimension.values.find((v) => v.value === point[dimension.id])?.label ??
        point[dimension.id],
    )
    .filter(Boolean)
    .join(', ')
}

function variantCommand(
  node: NodeDto,
  workspaceName: string,
  targetPoint: DimensionSpacePoint,
): Command {
  return {
    type: 'CreateNodeVariant',
    payload: {
      workspaceName,
      nodeAggregateId: node.aggregateId,
      sourceOrigin: node.originDimensionSpacePoint,
      targetOrigin: targetPoint,
    },
  }
}

/**
 * Commands recreating a document's content in the target dimension: variants
 * for every regular content node below it, in parent-before-child order (the
 * batch executes sequentially, so each parent exists before its children).
 * Tethered nodes (autocreated collections) are skipped - the content
 * repository varies them together with their parent - but their children are
 * regular nodes that do need commands, so recursion continues through them.
 */
async function collectContentCommands(
  document: NodeDto,
  workspaceName: string,
  targetPoint: DimensionSpacePoint,
  commands: Command[],
): Promise<void> {
  const walk = async (address: string) => {
    const children = await fetchChildren(address, `!${DOCUMENT_NODE_TYPE}`)
    for (const child of children) {
      if (child.classification === 'regular') {
        commands.push(variantCommand(child, workspaceName, targetPoint))
      }
      await walk(child.address)
    }
  }
  await walk(document.address)
}

type Phase = 'analyzing' | 'ready' | 'creating'

/**
 * Modal shown when the user picks a dimension the selected document does not
 * exist in (mirrors the Neos UI node variant creation dialog): create the
 * variant empty or with the content copied from the current dimension.
 * Ancestor documents missing in the target dimension are created alongside,
 * top-down - a document cannot exist without its rootline.
 */
export function CreateVariantDialog({
  document,
  targetPoint,
  dimensions,
  workspaceName,
  onCancel,
  onCreated,
}: {
  document: NodeDto
  targetPoint: DimensionSpacePoint
  dimensions: ContentDimension[]
  workspaceName: string
  onCancel: () => void
  onCreated: (point: DimensionSpacePoint) => void
}) {
  const [phase, setPhase] = useState<Phase>('analyzing')
  const [missingAncestors, setMissingAncestors] = useState<NodeDto[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Ancestors come closest-first; keep only documents that do not exist
        // in the target dimension and reverse to creation (top-down) order.
        const ancestors = await fetchAncestors(
          document.address,
          DOCUMENT_NODE_TYPE,
        )
        const missing: NodeDto[] = []
        for (const ancestor of ancestors) {
          const variants = await fetchNodeVariants(ancestor.address)
          if (
            !variants.coveredDimensionSpacePoints.some((point) =>
              dimensionSpacePointEquals(point, targetPoint),
            )
          ) {
            missing.push(ancestor)
          }
        }
        if (!cancelled) {
          setMissingAncestors(missing.reverse())
          setPhase('ready')
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setPhase('ready')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [document.address, targetPoint])

  const create = async (copyContent: boolean) => {
    setPhase('creating')
    setError(null)
    try {
      const commands: Command[] = []
      for (const doc of [...missingAncestors, document]) {
        commands.push(variantCommand(doc, workspaceName, targetPoint))
        if (copyContent) {
          await collectContentCommands(
            doc,
            workspaceName,
            targetPoint,
            commands,
          )
        }
      }
      await executeCommands(commands)
      onCreated(targetPoint)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('ready')
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && phase !== 'creating' && onCancel()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Create document in {pointLabel(targetPoint, dimensions)}?
          </DialogTitle>
          <DialogDescription>
            &ldquo;{nodeLabel(document)}&rdquo; does not exist in{' '}
            {pointLabel(targetPoint, dimensions)} yet.
            {phase === 'analyzing' &&
              ' Checking which parent documents are missing…'}
            {missingAncestors.length > 0 &&
              ` ${missingAncestors.length} missing parent document${missingAncestors.length === 1 ? '' : 's'} will be created as well.`}
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={phase === 'creating'}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => create(false)}
            disabled={phase !== 'ready'}
          >
            Create empty
          </Button>
          <Button onClick={() => create(true)} disabled={phase !== 'ready'}>
            {phase === 'creating' ? 'Creating…' : 'Create and copy content'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
