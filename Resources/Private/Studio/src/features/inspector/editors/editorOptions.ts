/**
 * The node type filter of an editor's `nodeTypes` option, a list or a
 * comma-separated string in Neos' NodeTypeCriteria syntax
 * ("Neos.Neos:Document,!Acme:Folder") - the fallback when it names none,
 * and in front of a filter that only excludes.
 */
export function nodeTypesFilter(
  options: Record<string, unknown>,
  fallback = 'Neos.Neos:Document',
): string {
  const entries = Array.isArray(options.nodeTypes)
    ? options.nodeTypes.filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : typeof options.nodeTypes === 'string'
      ? options.nodeTypes.split(',')
      : []
  const filter = entries
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .join(',')
  if (filter === '') return fallback
  return filter.split(',').every((entry) => entry.startsWith('!'))
    ? `${fallback},${filter}`
    : filter
}
