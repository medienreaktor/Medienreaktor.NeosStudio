/**
 * Sorting by Neos/Flow "position" values, as used throughout node type
 * configuration (inspector tabs, groups and properties).
 *
 * Supported positions - the pragmatic subset of Flow's PositionalArraySorter:
 *   - a number or numeric string: ascending; entries without a position
 *     default to their declaration index
 *   - "start" / "start <weight>": before all numeric entries, higher weight
 *     first
 *   - "end" / "end <weight>": after all numeric entries, higher weight last
 *   - "before <key>" / "after <key>": placed adjacent to the referenced
 *     entry; an unknown key degrades to start/end respectively
 */

export interface Positioned {
  key: string
  position?: string | number | null
}

type Parsed =
  | { kind: 'middle'; value: number }
  | { kind: 'start' | 'end'; weight: number }
  | { kind: 'before' | 'after'; reference: string }

function parse(position: string | number | null | undefined, declarationIndex: number): Parsed {
  if (position === null || position === undefined) return { kind: 'middle', value: declarationIndex }
  if (typeof position === 'number') return { kind: 'middle', value: position }
  const trimmed = position.trim()
  if (/^-?\d+$/.test(trimmed)) return { kind: 'middle', value: parseInt(trimmed, 10) }
  const [word, argument] = trimmed.split(/\s+/, 2)
  if (word === 'start' || word === 'end') {
    return { kind: word, weight: argument !== undefined ? parseInt(argument, 10) || 0 : 0 }
  }
  if ((word === 'before' || word === 'after') && argument) {
    return { kind: word, reference: argument }
  }
  // Unparseable - treat like an unpositioned entry.
  return { kind: 'middle', value: declarationIndex }
}

/** Returns the keys of the entries in position order. */
export function sortByPosition(entries: Positioned[]): string[] {
  const parsed = entries.map((entry, index) => ({ key: entry.key, spec: parse(entry.position, index) }))

  const starts = parsed.filter((p) => p.spec.kind === 'start') as { key: string; spec: { weight: number } }[]
  const middles = parsed.filter((p) => p.spec.kind === 'middle') as { key: string; spec: { value: number } }[]
  const ends = parsed.filter((p) => p.spec.kind === 'end') as { key: string; spec: { weight: number } }[]

  // Stable sorts - ties keep declaration order.
  const ordered = [
    ...starts.sort((a, b) => b.spec.weight - a.spec.weight),
    ...middles.sort((a, b) => a.spec.value - b.spec.value),
    ...ends.sort((a, b) => a.spec.weight - b.spec.weight),
  ].map((p) => p.key)

  // Relative entries are spliced in afterwards; entries referencing another
  // relative entry resolve as long as their target was declared earlier.
  for (const { key, spec } of parsed) {
    if (spec.kind !== 'before' && spec.kind !== 'after') continue
    const referenceIndex = ordered.indexOf(spec.reference)
    if (referenceIndex === -1) {
      if (spec.kind === 'before') ordered.unshift(key)
      else ordered.push(key)
    } else {
      ordered.splice(spec.kind === 'before' ? referenceIndex : referenceIndex + 1, 0, key)
    }
  }

  return ordered
}
