import { useMutation } from '@tanstack/react-query'
import { rawRequest } from '@/api/client'

export interface ConsoleRequest {
  method: string
  path: string
  body?: string
}

/**
 * Free-form request as a mutation: results (including non-2xx) resolve as
 * data for display; only network failures surface as mutation errors.
 */
export function useConsoleRequest() {
  return useMutation({
    mutationFn: ({ method, path, body }: ConsoleRequest) => rawRequest(method, path, body),
  })
}
