/**
 * Where a reference editor reads its selection from and writes it to:
 *
 *  - `graph`: a Neos 9 reference (`references:` in the node type, which the
 *    inspector and the creation dialog pass as subject type `reference` /
 *    `references`). The selection is read from the node's references and the
 *    picked ids are persisted with SetNodeReferences.
 *  - `value`: anything else - a `string` or `array` property, a plugin
 *    host's own field. The selection is the `value` prop, and picks are
 *    committed as values: one id (or null) or a list of ids.
 *
 * The inspector persists with SetNodeReferences on exactly these two types,
 * so the editor's mode and the way a commit is stored cannot disagree.
 */
export type ReferenceEditorMode = 'graph' | 'value'

export function referenceEditorMode(subjectType: string): ReferenceEditorMode {
  return subjectType === 'reference' || subjectType === 'references'
    ? 'graph'
    : 'value'
}

/**
 * The node ids a stored value names, in order: a string id, a list of
 * them, or nothing. Anything else (numbers, objects, empty strings) names
 * no id; duplicates count once.
 */
export function parseReferenceIds(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value]
  const ids = items.filter(
    (item): item is string => typeof item === 'string' && item !== '',
  )
  return [...new Set(ids)]
}

/**
 * What an editor commits for a selection: a list of ids for the multi
 * variant (empty when cleared), the id or null for the single one.
 */
export function committedReferenceValue(
  ids: readonly string[],
  multiple: boolean,
): string | null | string[] {
  return multiple ? [...ids] : (ids[0] ?? null)
}

/** How a selected target shows: what its node says about it. */
export type ReferenceTargetState = 'loading' | 'resolved' | 'hidden' | 'missing'

/**
 * A target by its resolved node: undefined while it loads, null when it
 * does not resolve (removed, or not readable), hidden when it or an
 * ancestor is hidden - it does not render in live.
 */
export function referenceTargetState(
  node: { isHidden?: boolean; isHiddenByAncestor?: boolean } | null | undefined,
): ReferenceTargetState {
  if (node === undefined) return 'loading'
  if (node === null) return 'missing'
  return node.isHidden || node.isHiddenByAncestor ? 'hidden' : 'resolved'
}
