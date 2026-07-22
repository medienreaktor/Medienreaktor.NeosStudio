import { useState } from 'react'

import { ApiError } from '@/api/client'
import { deleteAsset, type MediaAsset } from '@/api/media'
import { translate as t } from '@/lib/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

/** The asset a right-click context menu was opened for. */
export interface AssetMenuTarget {
  asset: MediaAsset
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
    // Surface the server's in-use guard as a readable message in the dialog.
    if (
      e instanceof ApiError &&
      (e.body as { error?: string } | null)?.error === 'asset_in_use'
    ) {
      throw new Error(
        t('media.assetInUse', 'This asset is in use and cannot be deleted.'),
      )
    }
    throw new Error(t('media.deleteAssetFailed', 'Deleting the asset failed.'))
  }
}

/**
 * The right-click actions for an asset in the grid or list: edit (opens the
 * details dialog) and delete. Mirrors MediaItemActions - an invisible anchor
 * at the click point, with the delete confirmation rendered unconditionally
 * so it survives the menu closing.
 */
export function AssetContextMenu({
  target,
  onClose,
  onEdit,
}: {
  target: AssetMenuTarget | null
  onClose: () => void
  /** Opens the asset details dialog. */
  onEdit: (asset: MediaAsset) => void
}) {
  const [deleting, setDeleting] = useState<MediaAsset | null>(null)

  const deletable =
    target !== null &&
    !target.asset.isReadOnly &&
    target.asset.localAssetIdentifier !== null

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
              variant="destructive"
              disabled={!deletable}
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

      <ConfirmDialog
        open={deleting !== null}
        title={t('media.deleteAssetTitle', 'Delete this asset?')}
        description={t(
          'media.deleteAssetDescription',
          'The asset will be permanently removed. Assets that are still in use cannot be deleted.',
        )}
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={() =>
          deleting?.localAssetIdentifier
            ? removeAsset(deleting.localAssetIdentifier)
            : undefined
        }
      />
    </>
  )
}
