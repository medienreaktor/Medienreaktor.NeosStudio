import { isConflict } from '@/api/http/errors'
import { listWorkspaceEvents } from '@/api/neos/endpoints/workspaces'
import type { Event, PaginatedEventListing } from '@/api/neos/schema'
import type { WorkspaceFeedEvent } from '@/features/collaboration/types'
import type { TransportCallbacks } from './transport'

/**
 * The collaboration change feed: the workspace's events from Neos.Api,
 * tailed by cursor and classified client-side into feed events - the ONE
 * place the feed is read and classified. Deliberately NOT TanStack queries -
 * the feed is a cursor over an append-only log, not cacheable server state.
 *
 * Both transports drive the same {@link createFeedTail}: the polling
 * transport on an interval, the WebSocket transport whenever the realtime
 * sidecar signals that the workspace's feed head moved. Either way the
 * events are read with the editor's own token, so Neos.Api's per-node read
 * filtering decides what each editor sees.
 */

/**
 * How feed clients should react to an event type: 'content' = a node's
 * rendered element / properties changed (re-render in place), 'structure' =
 * the node tree changed shape (refresh trees, reload the preview). Event
 * types not listed (stream bookkeeping like ContentStreamWasForked) are not
 * surfaced. The workspace history (features/workspaces/historyData.ts)
 * classifies with the same table.
 */
const FEED_EVENT_KINDS: Record<string, 'content' | 'structure'> = {
  NodePropertiesWereSet: 'content',
  NodeReferencesWereSet: 'content',
  NodeAggregateWithNodeWasCreated: 'structure',
  NodeAggregateWasMoved: 'structure',
  NodeAggregateWasRemoved: 'structure',
  SubtreeWasTagged: 'structure',
  SubtreeWasUntagged: 'structure',
  NodeAggregateTypeWasChanged: 'structure',
  NodeAggregateNameWasChanged: 'structure',
  NodeSpecializationVariantWasCreated: 'structure',
  NodeGeneralizationVariantWasCreated: 'structure',
  NodePeerVariantWasCreated: 'structure',
}

const POINT_KEYS = [
  'originDimensionSpacePoint',
  'coveredDimensionSpacePoint',
  'dimensionSpacePoint',
  'sourceOrigin',
  'targetOrigin',
  'specializationOrigin',
  'generalizationOrigin',
  'peerOrigin',
]
const POINT_SET_KEYS = [
  'affectedDimensionSpacePoints',
  'affectedOccupiedDimensionSpacePoints',
  'affectedCoveredDimensionSpacePoints',
  'affectedSourceOriginDimensionSpacePoints',
]

const isPoint = (value: unknown): value is Record<string, string> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

/**
 * One raw event as a feed event, or null for event types the feed does not
 * surface.
 */
export function parseFeedEvent(event: Event): WorkspaceFeedEvent | null {
  const kind = FEED_EVENT_KINDS[event.type]
  if (kind === undefined) return null
  const payload = event.payload ?? {}

  // The dimension space points an event names, whatever it calls them -
  // single points and sets alike. Empty = "affects every dimension".
  const dimensionSpacePoints: Record<string, string>[] = []
  for (const key of POINT_KEYS) {
    if (isPoint(payload[key])) dimensionSpacePoints.push(payload[key])
  }
  for (const key of POINT_SET_KEYS) {
    const set = payload[key]
    // Serialized point sets are lists - or maps keyed by the point's hash.
    const points = Array.isArray(set)
      ? set
      : isPoint(set)
        ? Object.values(set)
        : []
    for (const point of points) {
      if (isPoint(point)) dimensionSpacePoints.push(point)
    }
  }

  const commandClass = stringOrNull(event.metadata?.commandClass)
  return {
    sequenceNumber: event.sequenceNumber,
    version: event.version,
    type: event.type,
    kind,
    nodeAggregateId:
      stringOrNull(payload.nodeAggregateId) ??
      stringOrNull(payload.sourceNodeAggregateId),
    parentNodeAggregateId:
      stringOrNull(payload.parentNodeAggregateId) ??
      stringOrNull(payload.newParentNodeAggregateId),
    dimensionSpacePoints,
    tag: stringOrNull(payload.tag),
    initiatingUserId: stringOrNull(event.metadata?.initiatingUserId),
    recordedAt: event.recordedAt,
    command:
      commandClass === null
        ? null
        : commandClass.slice(commandClass.lastIndexOf('\\') + 1),
    initiatingTimestamp: stringOrNull(event.metadata?.initiatingTimestamp),
  }
}

/** Events per poll; a full page means the client must refresh wholesale. */
const FEED_PAGE_SIZE = 100

/** Where to start tailing: the newest event of the current content stream. */
interface FeedCursor {
  stream: string
  /** null = the stream has no (visible) event yet - baseline again. */
  after: number | null
}

/** The baseline: the current position to tail from, nothing to replay. */
export async function fetchWorkspaceFeedBaseline(
  workspaceName: string,
): Promise<FeedCursor> {
  const page = await listWorkspaceEvents(workspaceName, {
    sort: '-sequenceNumber',
    limit: 1,
  })
  return {
    stream: page.meta.contentStreamId,
    after: page.data[0]?.sequenceNumber ?? null,
  }
}

type FeedPoll =
  /** The workspace moved to another content stream (publish/discard/rebase). */
  | { status: 'reset' }
  | {
      status: 'ok'
      stream: string
      /** The cursor to poll from next. */
      after: number
      /** The page was full - more events exist than it carries. */
      truncated: boolean
      events: WorkspaceFeedEvent[]
    }

/** The events after the cursor, oldest first, classified. */
export async function pollWorkspaceFeed(
  workspaceName: string,
  cursor: { stream: string; after: number },
): Promise<FeedPoll> {
  let page: PaginatedEventListing
  try {
    page = await listWorkspaceEvents(workspaceName, {
      after: cursor.after,
      limit: FEED_PAGE_SIZE,
    })
  } catch (error) {
    // The cursor is from an earlier content stream: the workspace was
    // published, discarded or rebased since.
    if (isConflict(error)) {
      return { status: 'reset' }
    }
    throw error
  }
  if (page.meta.contentStreamId !== cursor.stream) return { status: 'reset' }
  const last = page.data[page.data.length - 1]
  return {
    status: 'ok',
    stream: page.meta.contentStreamId,
    after: last?.sequenceNumber ?? cursor.after,
    truncated: page.data.length >= FEED_PAGE_SIZE,
    events: page.data
      .map(parseFeedEvent)
      .filter((event): event is WorkspaceFeedEvent => event !== null),
  }
}

/**
 * A cursor over the workspace's feed and what moves it: baseline, then
 * incremental pages, handing the bridge new events or - when increments
 * cannot describe what happened - a wholesale "workspace changed".
 */
export interface FeedTail {
  /**
   * Catch up with the feed now. A call while one is running is not lost: it
   * coalesces into a single follow-up run.
   */
  tick(): void
  /** Whether the tail already is at (or past) the given feed head. */
  isAt(head: { stream: string; sequenceNumber: number | null }): boolean
  stop(): void
}

export function createFeedTail(
  workspaceName: string,
  callbacks: Pick<TransportCallbacks, 'onEvents' | 'onWorkspaceChanged'>,
  options: {
    /** Runs once, after the tail took its first baseline. */
    onFirstBaseline?: () => void
  } = {},
): FeedTail {
  let stopped = false
  let running = false
  let again = false
  let baselined = false
  // null = no position yet: the next run takes the baseline.
  let cursor: { stream: string; after: number } | null = null

  const baseline = async () => {
    const position = await fetchWorkspaceFeedBaseline(workspaceName)
    if (stopped) return
    // A stream without a visible event yet has no position - the next run
    // baselines again.
    if (position.after === null) return
    cursor = { stream: position.stream, after: position.after }
    if (!baselined) {
      baselined = true
      options.onFirstBaseline?.()
    }
  }

  const step = async () => {
    if (cursor === null) {
      // Baseline: adopt the current position, nothing to replay.
      await baseline()
      return
    }
    const result = await pollWorkspaceFeed(workspaceName, cursor)
    if (stopped) return
    if (result.status === 'reset' || result.truncated) {
      // The workspace moved to a different content stream (publish/discard/
      // rebase), or more happened than one page describes: its content
      // changed wholesale. Re-baseline FIRST and only then ask for the
      // wholesale refresh - the refresh then reads a state at least as new
      // as the cursor, and nothing falls in between.
      cursor = null
      try {
        await baseline()
      } catch {
        /* the next run baselines again */
      }
      if (!stopped) callbacks.onWorkspaceChanged()
      return
    }
    cursor = { stream: result.stream, after: result.after }
    if (result.events.length > 0) callbacks.onEvents(result.events)
  }

  return {
    tick() {
      if (stopped) return
      if (running) {
        again = true
        return
      }
      running = true
      void (async () => {
        try {
          do {
            again = false
            try {
              await step()
            } catch {
              /* offline / a hiccup - the next run retries with the same cursor */
            }
          } while (again && !stopped)
        } finally {
          running = false
        }
      })()
    },
    isAt(head) {
      return (
        cursor !== null &&
        head.stream === cursor.stream &&
        head.sequenceNumber !== null &&
        head.sequenceNumber <= cursor.after
      )
    },
    stop() {
      stopped = true
    },
  }
}

// --- Hand-over between the transports ----------------------------------------

/**
 * Workspaces whose realtime connection dropped while authenticated - the
 * window in which change signals were missed. The polling fallback that
 * takes over only starts tailing from its own baseline, so it consumes the
 * mark and asks for one wholesale refresh after that baseline: whatever
 * happened between the drop and the baseline is not lost. A reconnect (or
 * the session ending) clears it.
 */
const realtimeGaps = new Set<string>()

export function markRealtimeGap(workspaceName: string): void {
  realtimeGaps.add(workspaceName)
}

export function clearRealtimeGap(workspaceName: string): void {
  realtimeGaps.delete(workspaceName)
}

/** Whether a realtime gap was marked; consumes the mark. */
export function takeRealtimeGap(workspaceName: string): boolean {
  return realtimeGaps.delete(workspaceName)
}
