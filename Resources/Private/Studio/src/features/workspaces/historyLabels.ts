import type { WorkspacePendingStep } from '@/api/workspaces'
import { translate as t } from '@/lib/i18n'

/**
 * Human labels for the pending-history vocabulary: the ESCR event types the
 * feed surfaces and the commands that caused them (one command = one editing
 * step = one commit dot). Resolved at render time - module-level t() would
 * run before the XLIFF catalog is loaded.
 */

/**
 * The kind of edit a step/event represents, for the classic Neos change
 * colors: additions green, modifications orange, removals red. The theme's
 * green/orange hues ARE the Neos brand palette (styles.css).
 */
export type ChangeTone = 'add' | 'change' | 'remove'

/** Text color per tone - the 400 tier for legibility on the dark surface. */
export const TONE_TEXT_CLASSES: Record<ChangeTone, string> = {
  add: 'text-green-400',
  change: 'text-orange-400',
  remove: 'text-red-400',
}

const EVENT_TYPE_TONES: Record<string, ChangeTone> = {
  NodeAggregateWithNodeWasCreated: 'add',
  NodeSpecializationVariantWasCreated: 'add',
  NodeGeneralizationVariantWasCreated: 'add',
  NodePeerVariantWasCreated: 'add',
  NodeAggregateWasRemoved: 'remove',
}

/**
 * Deleting a node tags it "removed" (a soft removal) and hiding it tags it
 * "disabled" - one event type, two user actions the log must tell apart.
 * `tag` is the subtree tag the event carries, null for every other type.
 */
export function eventTone(type: string, tag?: string | null): ChangeTone {
  if (type === 'SubtreeWasTagged' && tag === 'removed') return 'remove'
  return EVENT_TYPE_TONES[type] ?? 'change'
}

const EVENT_TYPE_LABELS: Record<string, () => string> = {
  NodePropertiesWereSet: () =>
    t('workspaceGraph.event.propertiesChanged', 'Properties changed'),
  NodeReferencesWereSet: () =>
    t('workspaceGraph.event.referencesChanged', 'References changed'),
  NodeAggregateWithNodeWasCreated: () =>
    t('workspaceGraph.event.nodeCreated', 'Created'),
  NodeAggregateWasMoved: () => t('workspaceGraph.event.nodeMoved', 'Moved'),
  NodeAggregateWasRemoved: () =>
    t('workspaceGraph.event.nodeRemoved', 'Removed'),
  SubtreeWasTagged: () =>
    t('workspaceGraph.event.visibilityChanged', 'Visibility changed'),
  SubtreeWasUntagged: () =>
    t('workspaceGraph.event.visibilityChanged', 'Visibility changed'),
  // Keyed by "<type>:<tag>", see eventTypeLabel() below.
  'SubtreeWasTagged:removed': () =>
    t('workspaceGraph.event.nodeRemoved', 'Removed'),
  'SubtreeWasUntagged:removed': () =>
    t('workspaceGraph.event.nodeRestored', 'Restored'),
  'SubtreeWasTagged:disabled': () => t('workspaceGraph.step.hidden', 'Hidden'),
  'SubtreeWasUntagged:disabled': () => t('workspaceGraph.step.shown', 'Shown'),
  NodeAggregateTypeWasChanged: () =>
    t('workspaceGraph.event.typeChanged', 'Type changed'),
  NodeAggregateNameWasChanged: () =>
    t('workspaceGraph.event.renamed', 'Renamed'),
  NodeSpecializationVariantWasCreated: () =>
    t('workspaceGraph.event.variantCreated', 'Variant created'),
  NodeGeneralizationVariantWasCreated: () =>
    t('workspaceGraph.event.variantCreated', 'Variant created'),
  NodePeerVariantWasCreated: () =>
    t('workspaceGraph.event.variantCreated', 'Variant created'),
}

export function eventTypeLabel(type: string, tag?: string | null): string {
  const tagged =
    tag != null ? EVENT_TYPE_LABELS[`${type}:${tag}`]?.() : undefined
  return tagged ?? EVENT_TYPE_LABELS[type]?.() ?? type
}

/**
 * Step labels keyed by originating command. The stream stores the low-level
 * serialized command variants; the plain names appear when a client issues
 * them directly - both spell the same user action.
 */
const COMMAND_INFO: Record<
  string,
  { icon: string; tone: ChangeTone; label: () => string }
> = {
  SetNodeProperties: {
    icon: 'fa-pen',
    tone: 'change',
    label: () =>
      t('workspaceGraph.event.propertiesChanged', 'Properties changed'),
  },
  SetSerializedNodeProperties: {
    icon: 'fa-pen',
    tone: 'change',
    label: () =>
      t('workspaceGraph.event.propertiesChanged', 'Properties changed'),
  },
  SetNodeReferences: {
    icon: 'fa-link',
    tone: 'change',
    label: () =>
      t('workspaceGraph.event.referencesChanged', 'References changed'),
  },
  SetSerializedNodeReferences: {
    icon: 'fa-link',
    tone: 'change',
    label: () =>
      t('workspaceGraph.event.referencesChanged', 'References changed'),
  },
  CreateNodeAggregateWithNode: {
    icon: 'fa-plus',
    tone: 'add',
    label: () => t('workspaceGraph.event.nodeCreated', 'Created'),
  },
  CreateNodeAggregateWithNodeAndSerializedProperties: {
    icon: 'fa-plus',
    tone: 'add',
    label: () => t('workspaceGraph.event.nodeCreated', 'Created'),
  },
  MoveNodeAggregate: {
    icon: 'fa-up-down-left-right',
    tone: 'change',
    label: () => t('workspaceGraph.event.nodeMoved', 'Moved'),
  },
  RemoveNodeAggregate: {
    icon: 'fa-trash',
    tone: 'remove',
    label: () => t('workspaceGraph.event.nodeRemoved', 'Removed'),
  },
  DisableNodeAggregate: {
    icon: 'fa-eye-slash',
    tone: 'change',
    label: () => t('workspaceGraph.step.hidden', 'Hidden'),
  },
  EnableNodeAggregate: {
    icon: 'fa-eye',
    tone: 'change',
    label: () => t('workspaceGraph.step.shown', 'Shown'),
  },
  TagSubtree: {
    icon: 'fa-tag',
    tone: 'change',
    label: () =>
      t('workspaceGraph.event.visibilityChanged', 'Visibility changed'),
  },
  UntagSubtree: {
    icon: 'fa-tag',
    tone: 'change',
    label: () =>
      t('workspaceGraph.event.visibilityChanged', 'Visibility changed'),
  },
  // Tagging is what deleting and hiding are made of - keyed by
  // "<command>:<tag>" so a step reads as the action the editor took,
  // see stepInfo().
  'TagSubtree:removed': {
    icon: 'fa-trash',
    tone: 'remove',
    label: () => t('workspaceGraph.event.nodeRemoved', 'Removed'),
  },
  'UntagSubtree:removed': {
    icon: 'fa-trash-arrow-up',
    tone: 'add',
    label: () => t('workspaceGraph.event.nodeRestored', 'Restored'),
  },
  'TagSubtree:disabled': {
    icon: 'fa-eye-slash',
    tone: 'change',
    label: () => t('workspaceGraph.step.hidden', 'Hidden'),
  },
  'UntagSubtree:disabled': {
    icon: 'fa-eye',
    tone: 'change',
    label: () => t('workspaceGraph.step.shown', 'Shown'),
  },
  ChangeNodeAggregateType: {
    icon: 'fa-arrow-right-arrow-left',
    tone: 'change',
    label: () => t('workspaceGraph.event.typeChanged', 'Type changed'),
  },
  ChangeNodeAggregateName: {
    icon: 'fa-i-cursor',
    tone: 'change',
    label: () => t('workspaceGraph.event.renamed', 'Renamed'),
  },
  CreateNodeVariant: {
    icon: 'fa-clone',
    tone: 'add',
    label: () => t('workspaceGraph.event.variantCreated', 'Variant created'),
  },
}

/**
 * The COMMAND_INFO key of a step: its command, qualified by the subtree tag
 * for the tagging commands - "TagSubtree" alone cannot tell a deletion from a
 * hide. Every event of one step shares the tag (one command, one tag).
 */
function stepInfo(
  step: WorkspacePendingStep,
): { icon: string; tone: ChangeTone; label: () => string } | undefined {
  if (step.command === null) return undefined
  const tag = step.events[0].tag
  return (
    (tag != null ? COMMAND_INFO[`${step.command}:${tag}`] : undefined) ??
    COMMAND_INFO[step.command]
  )
}

/** What kind of edit a step is, e.g. "Properties changed". */
export function stepLabel(step: WorkspacePendingStep): string {
  const info = stepInfo(step)
  if (info) return info.label()
  return eventTypeLabel(step.events[0].type, step.events[0].tag)
}

/** Font Awesome icon name (without the fa- prefixes) for a step's action. */
export function stepIcon(step: WorkspacePendingStep): string {
  return stepInfo(step)?.icon ?? 'fa-circle-dot'
}

/** Whether a step adds, changes or removes content. */
export function stepTone(step: WorkspacePendingStep): ChangeTone {
  return (
    stepInfo(step)?.tone ?? eventTone(step.events[0].type, step.events[0].tag)
  )
}

/** "Properties changed: About us (+2 more)" - the one-line step summary. */
export function stepSummary(step: WorkspacePendingStep): string {
  const nodeLabels = [
    ...new Set(
      step.events
        .map((event) => event.nodeLabel ?? event.nodeAggregateId)
        .filter((label): label is string => label !== null),
    ),
  ]
  const subject =
    nodeLabels.length === 0
      ? ''
      : nodeLabels.length === 1
        ? nodeLabels[0]
        : t('workspaceGraph.step.nodeCount', '{0} (+{1} more)', [
            nodeLabels[0],
            String(nodeLabels.length - 1),
          ])
  return subject === '' ? stepLabel(step) : `${stepLabel(step)}: ${subject}`
}

/** A compact relative timestamp: "2m ago", "3h ago", else a local date. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const minutes = Math.round((Date.now() - then) / 60_000)
  if (minutes < 1) return t('workspaceGraph.time.justNow', 'just now')
  if (minutes < 60)
    return t('workspaceGraph.time.minutesAgo', '{0}m ago', [String(minutes)])
  const hours = Math.round(minutes / 60)
  if (hours < 24)
    return t('workspaceGraph.time.hoursAgo', '{0}h ago', [String(hours)])
  return new Date(iso).toLocaleDateString()
}
