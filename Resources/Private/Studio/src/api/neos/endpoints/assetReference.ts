/**
 * The asset id read off a property value: Neos.Api's `{id, url}`, tolerating
 * a bare id and the content repository's serialized object reference
 * (`{__flow_object_type, __identifier}`) - which Neos.Api passes through
 * as stored when it cannot resolve a value to assets, e.g. a list one of
 * whose assets is gone.
 */
export function referenceIdentifier(value: unknown): string | null {
  if (typeof value === 'string') return value === '' ? null : value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const id = record.id ?? record.__identifier
    if (typeof id === 'string' && id !== '') return id
  }
  return null
}
