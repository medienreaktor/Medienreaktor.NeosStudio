import { useState } from 'react'

import { deleteAsset, isAssetInUse } from '@/api/neos/endpoints/assets'
import type { Asset } from '@/api/neos/schema'
import { translate as t } from '@/lib/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ReplaceAssetDialog } from './ReplaceAssetDialog'

/** The asset a right-click context menu was opened for. */
export interface AssetMenuTarget {
  asset: Asset
  /** Viewport point the right-click happened at, to anchor the menu. */
  anchor: { x: number; y: number }
}

/**
 * Deletes an asset, translating the server's guard errors into readable
 * messages. Shared by the details dialog's delete button and the context menu.
 */
export async function removeAsset(localId: string): Promise<void> {
  try {
    await deleteAsset(localId)
  } catch (e) {
    // Surface the server's in-use guard (409) as a readable message.
    if (isAssetInUse(e)) {
      throw new Error(
        t('media.assetInUse', 'This asset is in use and cannot be deleted.'),
        { cause: e },
      )
    }
    throw new Error(
      t('media.deleteAssetFailed', 'Deleting the asset failed.'),
      {
        cause: e,
      },
    )
  }
}

/**
 * The right-click actions for an asset in the grid or list: edit (opens the
 * details dialog), replace its file and delete. Mirrors MediaItemActions - an
 * invisible anchor at the click point, with the delete confirmation and the
 * replace dialog rendered outside the menu so they survive it closing.
 */
export function AssetContextMenu({
  target,
  onClose,
  onEdit,
}: {
  target: AssetMenuTarget | null
  onClose: () => void
  /** Opens the asset details dialog. */
  onEdit: (asset: Asset) => void
}) {
  const [deleting, setDeleting] = useState<Asset | null>(null)
  const [replacing, setReplacing] = useState<Asset | null>(null)

  const writable =
    target !== null &&
    !target.asset.isReadOnly &&
    target.asset.localAssetId !== null
  // A cropped variant's file is derived from its original, so there is nothing
  // of its own to replace.
  const replaceable = writable && !target.asset.originalAssetId

  return (
    <>
      {target && (
        <DropdownMenu open onOpenChange={(open) => !open && onClose()}>
          <DropdownMenuTrigger
            aria-hidden
            tabIndex={-1}
            style={{
              position: 'fixed',
              left: target.anchor.x,
              top: target.anchor.y,
              width: 1,
              height: 1,
              opacity: 0,
              pointerEvents: 'none',
            }}
          />
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onClick={() => {
                onEdit(target.asset)
                onClose()
              }}
            >
              <i className="fas fa-fw fa-pen" aria-hidden />
              {t('media.editAsset', 'Edit asset')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!replaceable}
              onClick={() => {
                setReplacing(target.asset)
                onClose()
              }}
            >
              <i className="fas fa-fw fa-arrow-up-from-bracket" aria-hidden />
              {t('media.replaceAsset', 'Replace file')}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={!writable}
              onClick={() => {
                setDeleting(target.asset)
                onClose()
              }}
            >
              <i className="fas fa-fw fa-trash-can" aria-hidden />
              {t('media.deleteAsset', 'Delete asset')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {replacing?.localAssetId && (
        <ReplaceAssetDialog
          asset={replacing}
          localId={replacing.localAssetId}
          onOpenChange={(open) => !open && setReplacing(null)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={t('media.deleteAssetTitle', 'Delete this asset?')}
        description={t(
          'media.deleteAssetDescription',
          'The asset will be permanently removed. Assets that are still in use cannot be deleted.',
        )}
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={() =>
          deleting?.localAssetId
            ? removeAsset(deleting.localAssetId)
            : undefined
        }
      />
    </>
  )
}
