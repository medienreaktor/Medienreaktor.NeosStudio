import type { AccessRoleConstraints } from '@/api/accessRoles'
import { translate as t } from '@/lib/i18n'

/** One badge in the role listing: what this role narrows, in a word. */
export interface ConstraintSummaryEntry {
  key: string
  icon: string
  label: string
  /** Title attribute - the specifics behind the count. */
  detail: string
}

/**
 * Condense a restriction set into badges. Deliberately counts rather than
 * enumerates: a role covering nine branches must stay one glanceable row, and
 * the specifics are one click away in the dialog. The full list still travels
 * in the title attribute, so hovering answers "which ones?" without it.
 */
export function constraintSummary(
  constraints: AccessRoleConstraints,
): ConstraintSummaryEntry[] {
  const entries: ConstraintSummaryEntry[] = []

  if (constraints.siteNodeNames.length > 0) {
    entries.push({
      key: 'sites',
      icon: 'fa-globe',
      label: t('accessRoles.badgeSites', '{0} site(s)', [
        String(constraints.siteNodeNames.length),
      ]),
      detail: constraints.siteNodeNames.join(', '),
    })
  }

  if (constraints.nodeTreeRules.length > 0) {
    const allowed = constraints.nodeTreeRules.filter((r) => r.mode === 'ALLOW')
    const denied = constraints.nodeTreeRules.filter((r) => r.mode === 'DENY')
    entries.push({
      key: 'tree',
      icon: 'fa-sitemap',
      label:
        allowed.length > 0
          ? t('accessRoles.badgeBranches', '{0} branch(es)', [
              String(allowed.length),
            ])
          : t('accessRoles.badgeDenied', '{0} blocked', [
              String(denied.length),
            ]),
      detail: constraints.nodeTreeRules
        .map(
          (rule) =>
            `${rule.mode === 'ALLOW' ? '+' : '−'} ${rule.label || rule.nodeAggregateId}`,
        )
        .join(', '),
    })
  }

  const dimensionIds = Object.keys(constraints.dimensionValues)
  if (dimensionIds.length > 0) {
    entries.push({
      key: 'dimensions',
      icon: 'fa-language',
      label: t('accessRoles.badgeDimensions', 'Dimensions'),
      detail: dimensionIds
        .map((id) => `${id}: ${constraints.dimensionValues[id].join(', ')}`)
        .join(' · '),
    })
  }

  if (constraints.workspaceNames.length > 0) {
    entries.push({
      key: 'workspaces',
      icon: 'fa-layer-group',
      label: t('accessRoles.badgeWorkspaces', '{0} workspace(s)', [
        String(constraints.workspaceNames.length),
      ]),
      detail: constraints.workspaceNames.join(', '),
    })
  }

  if (!constraints.allowPublishToLive) {
    entries.push({
      key: 'publish',
      icon: 'fa-ban',
      label: t('accessRoles.badgeNoPublish', 'No publishing'),
      detail: t(
        'accessRoles.badgeNoPublishDetail',
        'Cannot publish to the live workspace.',
      ),
    })
  }

  const withheld = Object.entries(constraints.capabilities)
    .filter(([, granted]) => granted === false)
    .map(([capability]) => capability)
  if (withheld.length > 0) {
    entries.push({
      key: 'capabilities',
      icon: 'fa-lock',
      label: t('accessRoles.badgeCapabilities', '{0} restricted', [
        String(withheld.length),
      ]),
      detail: withheld.join(', '),
    })
  }

  return entries
}
