import { useEffect } from 'react'

import { toast } from '@/components/ui/toast'

/**
 * Raise an error toast when a query fails - the administration views' shared
 * "could not load X" notice, alongside the placeholder they render in place
 * of the list.
 *
 * Fires once per error object: a refetch that fails again yields a new error
 * and so a new toast, a re-render with the same error does not. The title is
 * a translated string, so it is compared by value and never re-fires on its
 * own.
 */
export function useQueryErrorToast(error: unknown, title: string): void {
  useEffect(() => {
    if (error) toast.error(error, { title })
  }, [error, title])
}
