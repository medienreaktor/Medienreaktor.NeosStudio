import { useQuery } from '@tanstack/react-query'
import { apiFetch, contentRepositoryPath } from '../client'
import { neosKeys } from '../keys'
import {
  type ContentDimension,
  type ContentRepository,
  parseDimensionSpacePoint,
} from '../schema'

/**
 * The content repository the Studio edits (Neos.Api's ContentRepositories
 * tag): its dimensions, depth-first with specializations after their
 * generalization, and all allowed dimension space points. Static per
 * deployment - cached for good.
 */
export function useContentRepository(enabled = true) {
  return useQuery({
    queryKey: neosKeys.contentRepository,
    queryFn: () => apiFetch<ContentRepository>(contentRepositoryPath()),
    staleTime: Infinity,
    enabled,
  })
}

/**
 * A label for a dimension space point: "English (US)", or "English (US),
 * Customers" with several dimensions. Falls back to the raw values while the
 * dimensions are not loaded (or a value is not configured).
 */
export function dimensionSpacePointLabel(
  dimensionSpacePoint: string,
  dimensions: ContentDimension[],
): string {
  const coordinates = parseDimensionSpacePoint(dimensionSpacePoint)
  if (dimensions.length === 0) return Object.values(coordinates).join(', ')
  return dimensions
    .map((dimension) => {
      const value = coordinates[dimension.id]
      return (
        dimension.values.find((candidate) => candidate.value === value)
          ?.label ?? value
      )
    })
    .filter(Boolean)
    .join(', ')
}
