import type { TaskStatus } from '@/api/tasks'
import { translate as t } from '@/lib/i18n'

/** The status as a word, wherever a task shows its state. */
export function taskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case 'DONE':
      return t('tasks.statusDone', 'done')
    case 'IN_REVIEW':
      return t('tasks.statusInReview', 'in review')
    default:
      return t('tasks.statusOpen', 'open')
  }
}

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
      return 'light-dark(var(--color-green-600), var(--color-green-400))'
    case 'IN_REVIEW':
      return 'light-dark(var(--color-orange-600), var(--color-orange-400))'
    default:
      return 'var(--color-blue-500)'
  }
}
