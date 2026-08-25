import type { Workspace, WorkspaceDocumentChange } from '@/api/workspaces'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { TONE_BG_CLASSES } from './historyLabels'

/**
 * The vocabulary a changed document is presented with, shared by every
 * surface that lists one: the review dialog and the side-by-side compare
 * view. One source, so the two can never disagree about what a workspace is
 * called or what "changed" looks like.
 */

/** "Live" for the root workspace, the title (or name) otherwise. */
export function workspaceLabel(
  workspace: Workspace | undefined,
  name: string,
): string {
  if (!workspace) return name
  return workspace.classification === 'ROOT'
    ? t('workspace.live', 'Live')
    : workspace.title || workspace.name
}

/**
 * The change verbs a document row can carry, in display priority order. Their
 * fill comes from the shared tone palette, so a review badge and a history
 * step speak of the same change in the same color: additions green, removals
 * red, modifications (moved as well as edited) blue.
 */
export const CHANGE_BADGES = [
  {
    key: 'created',
    label: 'New',
    labelKey: 'workspace.badge.new',
    icon: 'fa-plus',
    tone: 'add',
  },
  {
    key: 'deleted',
    label: 'Removed',
    labelKey: 'workspace.badge.removed',
    icon: 'fa-trash-can',
    tone: 'remove',
  },
  {
    key: 'moved',
    label: 'Moved',
    labelKey: 'workspace.badge.moved',
    icon: 'fa-arrows-up-down-left-right',
    tone: 'change',
  },
  {
    key: 'changed',
    label: 'Changed',
    labelKey: 'workspace.badge.changed',
    icon: 'fa-pen',
    tone: 'change',
  },
] as const

export function ChangeBadges({
  document,
  className,
}: {
  document: WorkspaceDocumentChange
  className?: string
}) {
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {CHANGE_BADGES.filter((badge) => document[badge.key]).map((badge) => (
        <span
          key={badge.key}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-neutral-950 dark:text-white',
            TONE_BG_CLASSES[badge.tone],
          )}
        >
          <i
            className={`fas fa-fw ${badge.icon} text-[0.625rem]`}
            aria-hidden
          />
          {t(badge.labelKey, badge.label)}
        </span>
      ))}
    </span>
  )
}
