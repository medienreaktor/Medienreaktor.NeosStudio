import type { TaskStatus } from '@/api/studio/schema'

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
      return 'var(--color-task-done-text)'
    case 'IN_REVIEW':
      return 'var(--color-task-in-review-text)'
    default:
      return 'var(--color-task-open-text)'
  }
}
