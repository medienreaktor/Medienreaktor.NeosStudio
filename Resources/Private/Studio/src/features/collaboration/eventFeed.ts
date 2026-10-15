import { isConflict } from '@/api/http/errors'
import { listWorkspaceEvents } from '@/api/neos/endpoints/workspaces'
import type { Event, PaginatedEventListing } from '@/api/neos/schema'
import type { WorkspaceFeedEvent } from '@/api/studio/schema'

/**
 * The collaboration change feed without the realtime sidecar: the
 * workspace's events from Neos.Api, tailed by cursor and classified
 * client-side into feed events. Deliberately NOT TanStack queries - the feed
 * is a cursor over an append-only log, not cacheable server state. The
 * polling transport drives it on an interval; the realtime sidecar tails the
 * same log server-side (RealtimeController, same classification) and pushes
 * identical feed events.
 */

/**
 * How feed clients should react to an event type: 'content' = a node's
 * rendered element / properties changed (re-render in place), 'structure' =
 * the node tree changed shape (refresh trees, reload the preview). Event
 * types not listed (stream bookkeeping like ContentStreamWasForked) are not
 * surfaced. Mirrors WorkspaceHistoryService::FEED_EVENT_KINDS (PHP), which
 * classifies the sidecar's feed.
 */
export const FEED_EVENT_KINDS: Record<string, 'content' | 'structure'> = {
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
 * surface. A port of WorkspaceHistoryService::parseFeedEvent() (PHP), so the
 * polling and the sidecar transport hand the bridge the same events.
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
export const FEED_PAGE_SIZE = 100

/** Where to start tailing: the newest event of the current content stream. */
export interface FeedCursor {
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

export type FeedPoll =
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
