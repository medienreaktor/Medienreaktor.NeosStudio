/**
 * Dimension space points as Neos.Api reads and writes them: JSON strings with
 * a value for each dimension, e.g. {"language":"de"} ({} without dimensions).
 * The string is what the shell keeps and passes on; its coordinates are only
 * parsed where they are looked at (labels, the dimension switcher).
 */

/** The coordinates of a dimension space point: a value for each dimension. */
export type DimensionCoordinates = Record<string, string>

export function parseDimensionSpacePoint(
  dimensionSpacePoint: string,
): DimensionCoordinates {
  try {
    const coordinates = JSON.parse(dimensionSpacePoint) as unknown
    return coordinates !== null && typeof coordinates === 'object'
      ? (coordinates as DimensionCoordinates)
      : {}
  } catch {
    return {}
  }
}

/** Whether two dimension space points are the same point, whatever their key order. */
export function sameDimensionSpacePoint(a: string, b: string): boolean {
  if (a === b) return true
  const left = parseDimensionSpacePoint(a)
  const right = parseDimensionSpacePoint(b)
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key])
  )
}
