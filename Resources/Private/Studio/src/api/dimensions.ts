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
