import type { AssetType } from '@/api/neos/schema'
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

/** Full local date and time, e.g. "15 Jul 2026, 14:03" - for tooltips. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/**
 * A filename split for display: the extension (with its dot) stays visible
 * while the stem truncates. No extension: the whole name is the stem.
 */
export function splitFilename(filename: string): {
  stem: string
  extension: string
} {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return { stem: filename, extension: '' }
  return { stem: filename.slice(0, dot), extension: filename.slice(dot) }
}

/**
 * The short format name people know - "JPEG", "PDF", "MP4" - instead of the
 * MIME type: the file extension, else the MIME subtype stripped of its
 * "x-" / "vnd." prefixes and "+xml"-style suffixes.
 */
export function formatLabel(filename: string, mediaType: string): string {
  const { extension } = splitFilename(filename)
  if (extension) {
    const ext = extension.slice(1).toUpperCase()
    return ext === 'JPG' ? 'JPEG' : ext
  }
  const subtype = (mediaType.split('/')[1] ?? mediaType)
    .replace(/^(x-|vnd\.)/, '')
    .replace(/\+.*$/, '')
  return subtype.toUpperCase()
}
