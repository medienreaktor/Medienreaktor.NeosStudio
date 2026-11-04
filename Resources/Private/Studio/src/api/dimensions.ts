import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { queryKeys } from './keys'

/** A concrete coordinate for every dimension, e.g. { language: "de" }. */
export type DimensionSpacePoint = Record<string, string>

export interface DimensionValue {
  value: string
  label: string
  /** 0 = root value, 1+ = specialization of the value listed before it */
  specializationDepth: number
}

export interface ContentDimension {
  id: string
  label: string
  /** Font Awesome icon name from the dimension configuration, e.g. "language" */
  icon: string | null
  /** Depth-first: specializations follow their generalization directly */
  values: DimensionValue[]
}

export interface DimensionsResponse {
  /** Ordered by configured priority */
  dimensions: ContentDimension[]
  allowedDimensionSpacePoints: DimensionSpacePoint[]
}

/** Dimension configuration is static per deployment - cache it forever. */
export function useDimensions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.dimensions,
    queryFn: () => apiFetch<DimensionsResponse>('/dimensions'),
    staleTime: Infinity,
    enabled,
  })
}

/**
 * Stable identity of a dimension space point, for grouping and comparing.
 * Sorted, so the same coordinates always produce the same key regardless of
 * how many dimensions a content repository configures or in which order they
 * arrived.
 */
export function dimensionSpacePointKey(
  point: DimensionSpacePoint | null | undefined,
): string {
  if (!point) return ''
  return Object.keys(point)
    .sort()
    .map((name) => `${name}=${point[name]}`)
    .join('&')
}

export function dimensionSpacePointEquals(
  a: DimensionSpacePoint,
  b: DimensionSpacePoint,
): boolean {
  const aKeys = Object.keys(a)
  return (
    aKeys.length === Object.keys(b).length &&
    aKeys.every((key) => a[key] === b[key])
  )
}

/**
 * Human-readable label for a dimension space point: "English (US)", or
 * "English (US), Customers" with several dimensions. Falls back to the raw
 * coordinate values while the dimension configuration is not loaded (or a
 * value is not configured).
 */
export function dimensionSpacePointLabel(
  point: DimensionSpacePoint,
  dimensions: ContentDimension[],
): string {
  if (dimensions.length === 0) return Object.values(point).join(', ')
  return dimensions
    .map(
      (dimension) =>
        dimension.values.find((v) => v.value === point[dimension.id])?.label ??
        point[dimension.id],
    )
    .filter(Boolean)
    .join(', ')
}
