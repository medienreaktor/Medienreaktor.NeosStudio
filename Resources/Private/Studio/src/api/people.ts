import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { apiFetch, type Listing } from './client'

/**
 * Neos.Api's people directory (GET /people): every Neos user's id and label,
 * readable by every editor - unlike the user administration listing. What the
 * shell names users by wherever it only has their id (workspace role
 * assignments, owners, task assignees).
 */
export interface Person {
  id: string
  label: string
}

/** Kept local on purpose: one list, invalidated by nothing but time. */
export const peopleQueryKey = ['people'] as const

/** People change rarely; a stale label for a few minutes is harmless. */
const PEOPLE_STALE_TIME = 5 * 60 * 1000

export async function fetchPeople(): Promise<Person[]> {
  // Unpaged by contract - all users, sorted by label.
  return (await apiFetch<Listing<Person>>('/people')).data
}

/** The people directory, shared with every other reader of it via the cache. */
export function fetchPeopleCached(): Promise<Person[]> {
  return queryClient.fetchQuery({
    queryKey: peopleQueryKey,
    queryFn: fetchPeople,
    staleTime: PEOPLE_STALE_TIME,
  })
}

export function usePeople(enabled = true) {
  return useQuery({
    queryKey: peopleQueryKey,
    queryFn: fetchPeople,
    staleTime: PEOPLE_STALE_TIME,
    enabled,
  })
}

/** id -> label of the people directory, for quick lookups. */
export function peopleLabels(
  people: Person[] | undefined,
): Map<string, string> {
  return new Map((people ?? []).map((person) => [person.id, person.label]))
}
