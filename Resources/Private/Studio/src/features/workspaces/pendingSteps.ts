import type { NodeAddress } from '@/api/neos/schema'
import type { WorkspacePendingEvent } from '@/api/studio/schema'

/**
 * One editing step of a workspace's pending history: the events one command
 * produced (a paste, a property change, a move...), the unit the Workspaces
 * graph draws as a single commit dot. Grouped client-side from consecutive
 * events sharing command, user and initiating timestamp.
 */
export interface WorkspacePendingStep {
  /** The first event's sequence number - stable id of the step. */
  id: number
  command: string | null
  /** Oldest first; never empty. */
  events: WorkspacePendingEvent[]
  /** Sequence-number range, for the diff resource. */
  from: number
  to: number
  /** Stream version of the last event - what fork points compare against. */
  version: number
  /** Who made the edit; the stable key an avatar takes its color from. */
  initiatingUserId: string | null
  initiatingUserLabel: string | null
  recordedAt: string
  /** The distinct documents the step touched (label of the first event wins). */
  documents: {
    id: string
    label: string | null
    address: NodeAddress | null
  }[]
}

/**
 * Property-set commands squash across executions: inline typing persists a
 * SetNodeProperties every 1.5-5s, and a paragraph of writing must read as
 * ONE step in the history, not thirty. Consecutive saves by the same user
 * on the same node squash while their initiating timestamps stay within
 * this sliding window ("one editing session on this element"). Only
 * CONSECUTIVE events squash, so anything interleaving (another user,
 * another element) cuts the step - the from..to sequence range stays exact
 * for the diff resource.
 */
const SQUASH_COMMANDS = new Set([
  'SetNodeProperties',
  'SetSerializedNodeProperties',
])
const SQUASH_WINDOW_MS = 30_000
/** Hard cap per squashed step - the pending-events diff resource rejects
 * sequence ranges of 200+, and a step must stay diffable. */
const SQUASH_MAX_EVENTS = 100

function withinSquashWindow(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false
  const first = Date.parse(a)
  const second = Date.parse(b)
  if (Number.isNaN(first) || Number.isNaN(second)) return false
  return Math.abs(second - first) <= SQUASH_WINDOW_MS
}

/**
 * Group a pending history (oldest first) into editing steps. Events of one
 * command commit contiguously, so grouping consecutive runs is exact; the
 * guard on command/timestamp presence keeps unknown events as single steps.
 * Rapid-fire property saves additionally squash across commands (see
 * SQUASH_COMMANDS above).
 */
export function groupPendingEvents(
  events: WorkspacePendingEvent[],
): WorkspacePendingStep[] {
  const steps: WorkspacePendingStep[] = []
  let current: WorkspacePendingStep | null = null
  for (const event of events) {
    const lastEvent = current?.events[current.events.length - 1] ?? null
    const joins =
      current !== null &&
      current.command !== null &&
      event.command === current.command &&
      ((event.initiatingTimestamp !== null &&
        event.initiatingTimestamp === current.events[0].initiatingTimestamp) ||
        // The typing-save squash: same user, same node, close enough in time.
        (SQUASH_COMMANDS.has(current.command) &&
          lastEvent !== null &&
          current.events.length < SQUASH_MAX_EVENTS &&
          event.nodeAggregateId !== null &&
          event.nodeAggregateId === lastEvent.nodeAggregateId &&
          withinSquashWindow(
            lastEvent.initiatingTimestamp,
            event.initiatingTimestamp,
          ))) &&
      event.initiatingUserId === current.events[0].initiatingUserId
    if (joins && current !== null) {
      current.events.push(event)
      current.to = event.sequenceNumber
      current.version = event.version
      current.recordedAt = event.recordedAt
      if (
        event.documentAggregateId !== null &&
        !current.documents.some((d) => d.id === event.documentAggregateId)
      ) {
        current.documents.push({
          id: event.documentAggregateId,
          label: event.documentLabel,
          address: event.documentAddress,
        })
      }
    } else {
      current = {
        id: event.sequenceNumber,
        command: event.command,
        events: [event],
        from: event.sequenceNumber,
        to: event.sequenceNumber,
        version: event.version,
        initiatingUserId: event.initiatingUserId,
        initiatingUserLabel: event.initiatingUserLabel,
        recordedAt: event.recordedAt,
        documents:
          event.documentAggregateId !== null
            ? [
                {
                  id: event.documentAggregateId,
                  label: event.documentLabel,
                  address: event.documentAddress,
                },
              ]
            : [],
      }
      steps.push(current)
    }
  }
  return steps
}
