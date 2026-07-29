import type { TaskStatus } from '@/api/tasks'

/**
 * The task status color, used wherever a status shows up (workspace badges,
 * board columns): open = Neos blue (in work), in review = orange (waiting on
 * a reviewer), done = green. Returns theme variables from styles.css so the
 * values track the Tailwind ramps; usable anywhere a CSS color is (including
 * color-mix()).
 */
export function taskStatusColor(status: TaskStatus): string {
  switch (status) {
    case 'DONE':
      return 'var(--color-green-400)'
    case 'IN_REVIEW':
      return 'var(--color-orange-400)'
    default:
      return 'var(--color-blue-500)'
  }
}
