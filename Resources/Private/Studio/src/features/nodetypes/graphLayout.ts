/**
 * Layered layout for the node type graph. Node type inheritance is a DAG
 * (multi-inheritance through mixins), so the classic tree layouts don't
 * apply; this is a small Sugiyama-style pass instead:
 *
 *  1. rank every type by its longest path from a root (types without known
 *     supertypes) - guaranteeing every supertype sits in an earlier column,
 *  2. order each column by the barycenter of the already-placed supertypes,
 *     so subtypes gravitate towards their parents and edges stay short,
 *  3. stack the (variable-height) cards per column and center the columns
 *     against the tallest one.
 *
 * Pure geometry - measuring/rendering stays with the caller, which passes
 * each card's precomputed pixel height.
 */

export const CARD_WIDTH = 280
const COLUMN_GAP = 110
const ROW_GAP = 28

export interface LayoutInput {
  name: string
  /** Declared super types - unknown names are ignored. */
  superTypes: string[]
  /** Card height in px, precomputed from the card's row count. */
  height: number
}

export interface PositionedCard {
  name: string
  x: number
  y: number
  height: number
}

/** One inheritance edge, pointing from the supertype to the subtype. */
export interface LayoutEdge {
  from: string
  to: string
}

export interface GraphLayout {
  cards: Map<string, PositionedCard>
  edges: LayoutEdge[]
  /** Total extents of the laid-out graph. */
  width: number
  height: number
}

export function layoutGraph(inputs: LayoutInput[]): GraphLayout {
  const byName = new Map(inputs.map((input) => [input.name, input]))

  // Longest path from a root. The cycle guard only matters for broken
  // configurations - the CR itself refuses cyclic supertype declarations.
  const depths = new Map<string, number>()
  const visiting = new Set<string>()
  const depthOf = (name: string): number => {
    const known = depths.get(name)
    if (known !== undefined) return known
    if (visiting.has(name)) return 0
    visiting.add(name)
    const parents = (byName.get(name)?.superTypes ?? []).filter((superType) =>
      byName.has(superType),
    )
    const depth =
      parents.length === 0
        ? 0
        : 1 + Math.max(...parents.map((parent) => depthOf(parent)))
    visiting.delete(name)
    depths.set(name, depth)
    return depth
  }

  const columns: LayoutInput[][] = []
  for (const input of inputs) {
    const depth = depthOf(input.name)
    ;(columns[depth] ??= []).push(input)
  }

  const cards = new Map<string, PositionedCard>()
  const centerOf = (card: PositionedCard) => card.y + card.height / 2

  columns.forEach((column, depth) => {
    // Root column alphabetically; later columns near their parents' mean
    // center (alphabetical tiebreak keeps the order stable).
    const keyed = column.map((input) => {
      const parentCenters = input.superTypes
        .map((superType) => cards.get(superType))
        .filter((card): card is PositionedCard => card !== undefined)
        .map(centerOf)
      const barycenter =
        parentCenters.length === 0
          ? Number.POSITIVE_INFINITY
          : parentCenters.reduce((sum, y) => sum + y, 0) /
            parentCenters.length
      return { input, barycenter }
    })
    keyed.sort(
      (a, b) =>
        a.barycenter - b.barycenter ||
        a.input.name.localeCompare(b.input.name),
    )

    const x = depth * (CARD_WIDTH + COLUMN_GAP)
    let y = 0
    for (const { input } of keyed) {
      cards.set(input.name, { name: input.name, x, y, height: input.height })
      y += input.height + ROW_GAP
    }
  })

  // Center every column against the tallest one.
  const columnHeights = columns.map((column) =>
    column.reduce((sum, input) => sum + input.height + ROW_GAP, -ROW_GAP),
  )
  const maxColumnHeight = Math.max(0, ...columnHeights)
  columns.forEach((column, depth) => {
    const offset = (maxColumnHeight - columnHeights[depth]) / 2
    for (const input of column) {
      const card = cards.get(input.name)!
      card.y += offset
    }
  })

  const edges: LayoutEdge[] = []
  for (const input of inputs) {
    for (const superType of input.superTypes) {
      if (byName.has(superType))
        edges.push({ from: superType, to: input.name })
    }
  }

  return {
    cards,
    edges,
    width:
      columns.length === 0
        ? 0
        : columns.length * (CARD_WIDTH + COLUMN_GAP) - COLUMN_GAP,
    height: maxColumnHeight,
  }
}
