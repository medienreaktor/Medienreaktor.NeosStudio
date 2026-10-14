import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { queryKeys } from './keys'
import { contentRepositoryPath } from './nodeAddress'

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
  /** Font Awesome classes from the dimension's ui.icon, e.g. "fas fa-language" */
  icon: string | null
  /** Depth-first: specializations follow their generalization directly */
  values: DimensionValue[]
}

export interface DimensionsResponse {
  /** Ordered by configured priority */
  dimensions: ContentDimension[]
  allowedDimensionSpacePoints: DimensionSpacePoint[]
}

/** The content repository as Neos.Api returns it (getContentRepository). */
interface ApiContentRepository {
  id: string
  dimensions: {
    id: string
    label: string | null
    icon?: string | null
    values: {
      value: string
      label: string | null
      generalization: string | null
      specializationDepth?: number
    }[]
  }[]
  /** All allowed points, each a JSON string. */
  dimensionSpacePoints?: string[]
}

async function loadDimensions(): Promise<DimensionsResponse> {
  const repository = await apiFetch<ApiContentRepository>(
    contentRepositoryPath(),
  )
  return {
    dimensions: repository.dimensions.map((dimension) => ({
      id: dimension.id,
      label: dimension.label ?? dimension.id,
      icon: dimension.icon ?? null,
      values: dimension.values.map((value) => ({
        value: value.value,
        label: value.label ?? value.value,
        specializationDepth: value.specializationDepth ?? 0,
      })),
    })),
    allowedDimensionSpacePoints: (repository.dimensionSpacePoints ?? []).map(
      (point) => JSON.parse(point) as DimensionSpacePoint,
    ),
  }
}

/** Dimension configuration is static per deployment - cache it forever. */
export function useDimensions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.dimensions,
    queryFn: loadDimensions,
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
