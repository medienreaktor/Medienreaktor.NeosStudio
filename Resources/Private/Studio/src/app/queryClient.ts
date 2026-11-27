import {
  QueryClient,
  type QueryFunction,
  type QueryKey,
} from '@tanstack/react-query'
import { ApiError } from '@/api/http/errors'
import { installQueryDebug } from './queryDebug'

// 4xx responses are deterministic (auth, permissions, bad address) —
// retrying only delays the error state. Network errors and 5xx retry.
export function defaultRetry(failureCount: number, error: unknown): boolean {
  return !(error instanceof ApiError && error.status < 500) && failureCount < 2
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: defaultRetry,
    },
  },
})

installQueryDebug(queryClient)

/**
 * fetchQuery for a read whose target may be gone: null for an error isGone
 * recognizes. The answer is remembered like data - a gone target is not
 * asked for again while it would still be fresh, unless invalidated.
 */
export async function fetchQueryOrNull<T>(
  options: { queryKey: QueryKey; queryFn: QueryFunction<T> },
  isGone: (error: unknown) => boolean,
): Promise<T | null> {
  const state = queryClient.getQueryState(options.queryKey)
  const staleTime = queryClient.getDefaultOptions().queries?.staleTime
  if (
    state?.status === 'error' &&
    isGone(state.error) &&
    !state.isInvalidated &&
    Date.now() - state.errorUpdatedAt <
      (typeof staleTime === 'number' ? staleTime : 0)
  ) {
    return null
  }
  try {
    // No retries: a gone target stays gone, and the client's default would
    // retry any error that is not an ApiError.
    return await queryClient.fetchQuery({ ...options, retry: false })
  } catch (error) {
    if (isGone(error)) return null
    throw error
  }
}
