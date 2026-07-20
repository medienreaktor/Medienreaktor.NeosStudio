import type { AssetType, MediaAsset } from '@/api/media'
import { cn } from '@/lib/utils'

const TYPE_ICON: Record<AssetType, string> = {
  Image: 'fa-file',
  Document: 'fa-file-lines',
  Video: 'fa-film',
  Audio: 'fa-music',
}

/**
 * The asset's thumbnail if it has one, otherwise a type icon. `preview` picks
 * the larger preview URI (for the details pane) over the grid thumbnail.
 */
export function AssetThumb({
  asset,
  preview = false,
  className,
}: {
  asset: MediaAsset
  preview?: boolean
  className?: string
}) {
  const uri = preview
    ? (asset.previewUri ?? asset.thumbnailUri)
    : (asset.thumbnailUri ?? asset.previewUri)
  if (asset.assetType === 'Image' && uri) {
    return (
      <img
        src={uri}
        alt={asset.label}
        loading="lazy"
        className={cn('h-full w-full aspect-square object-contain', className)}
      />
    )
  }
  const iconClass = TYPE_ICON[asset.assetType] ?? 'fa-file'
  return (
    <i
      className={cn('fas', iconClass, 'text-[2.5rem] text-neutral-600', className)}
      aria-hidden
    />
  )
}
