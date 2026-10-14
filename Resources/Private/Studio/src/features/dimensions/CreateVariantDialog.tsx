import { useState } from 'react'
import { createNodeVariant } from '@/api/commands'
import type { ContentDimension, DimensionSpacePoint } from '@/api/dimensions'
import { dimensionSpacePointLabel } from '@/api/dimensions'
import { addressInWorkspace } from '@/api/nodeAddress'
import { type NodeDto, nodeLabel } from '@/api/nodes'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Phase = 'ready' | 'creating'

/**
 * Modal shown when the user picks a dimension the selected document does not
 * exist in (mirrors the Neos UI node variant creation dialog): create the
 * variant empty or with the content copied from the current dimension. The
 * server creates ancestor documents missing in the target dimension along
 * with it, top-down - a document cannot exist without its rootline - and,
 * when copying, varies the content below the document.
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
  const [phase, setPhase] = useState<Phase>('ready')

  const create = async (copyContent: boolean) => {
    setPhase('creating')
    try {
      await createNodeVariant(
        addressInWorkspace(document.address, workspaceName),
        targetPoint,
        copyContent,
      )
      toast.success(t('dimension.variantCreated', 'Document variant created.'))
      onCreated(targetPoint)
    } catch (e) {
      toast.error(e, {
        title: t(
          'dimension.createVariantFailed',
          'Creating the variant failed',
        ),
      })
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
            {t('dimension.createTitle', 'Create document in {0}?', [
              dimensionSpacePointLabel(targetPoint, dimensions),
            ])}
          </DialogTitle>
          <DialogDescription>
            {t('dimension.notExistYet', '“{0}” does not exist in {1} yet.', [
              nodeLabel(document),
              dimensionSpacePointLabel(targetPoint, dimensions),
            ])}
            {t(
              'dimension.missingParentsCreated',
              ' Parent documents missing there are created as well.',
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={phase === 'creating'}
          >
            {t('action.cancel', 'Cancel')}
          </Button>
          <Button
            variant="outline"
            onClick={() => create(false)}
            disabled={phase !== 'ready'}
          >
            {t('dimension.createEmpty', 'Create empty')}
          </Button>
          <Button onClick={() => create(true)} disabled={phase !== 'ready'}>
            {phase === 'creating'
              ? t('dimension.creating', 'Creating…')
              : t('dimension.createAndCopy', 'Create and copy content')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
