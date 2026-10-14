import type { AssetType } from '@/api/media'
import { translate as t } from '@/lib/i18n'

/** Human-readable file size, e.g. 1536 -> "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  )
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

/** Short date like "15 Jul 2026" from an ISO timestamp. */
export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** The display label of an asset type (Neos.Api's are lowercase ids). */
export function assetTypeLabel(type: AssetType): string {
  switch (type) {
    case 'image':
      return t('media.typeImage', 'Image')
    case 'document':
      return t('media.typeDocument', 'Document')
    case 'video':
      return t('media.typeVideo', 'Video')
    case 'audio':
      return t('media.typeAudio', 'Audio')
    default:
      return type
  }
}
