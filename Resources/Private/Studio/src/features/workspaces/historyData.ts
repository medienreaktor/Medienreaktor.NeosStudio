import { useCallback, useMemo } from 'react'
import { skipToken, useQueries, useQuery } from '@tanstack/react-query'
import {
  activeContentRepositoryId,
  useActiveContentRepositoryId,
} from '@/api/neos/activeContentRepository'
import { listNodesById } from '@/api/neos/endpoints/nodes'
import { restoreNode } from '@/api/neos/endpoints/nodeCommands'
import { type NodeTypeMap, useNodeTypes } from '@/api/neos/endpoints/nodeTypes'
import { useUsers } from '@/api/neos/endpoints/users'
import {
  fetchWorkspaceChanges,
  listWorkspaceEvents,
  nextEventsAfter,
} from '@/api/neos/endpoints/workspaces'
import { neosKeys } from '@/api/neos/keys'
import {
  type Change,
  type ChangeDiff,
  type Event,
  type EventDiff,
  type Node,
  type NodeAddress,
  nodeAddressOf,
  type PaginatedEventListing,
  type Workspace,
} from '@/api/neos/schema'
import type { WorkspaceFeedEvent } from '@/features/collaboration/types'
import { queryClient } from '@/app/queryClient'
import { useStudio } from '@/app/StudioContext'
import { parseFeedEvent } from '@/features/collaboration/eventFeed'

/**
 * The review, pending history and trash of a workspace, read from Neos.Api's
 * workspace changes and events (with include=diff, node, document and their
 * ancestors) and shaped here into what the workspace panels show: changes
 * grouped by document, editing steps with before/after rows, deleted pages
 * with who deleted them. Labels of referenced nodes and parents, which the
 * diffs name by id, are read along, a listNodes request per subgraph.
 */

/** The kinds of before/after rows a diff shows, one vocabulary for all. */
type ValueChangeKind =
  | 'property'
  | 'reference'
  | 'nodeType'
  | 'name'
  | 'parent'
  | 'position'
  | 'tag'
  | 'variant'

/** A node a diff row names: references and parents, by label if readable. */
interface NodeLabel {
  id: string
  label: string | null
}

/** One before/after row of a diff. */
export interface ValueChange {
  kind: ValueChangeKind
  /** The property, reference or tag, null for the other kinds. */
  property: string | null
  /** The property's or reference's configured label. */
  label: string | null
  old: unknown
  new: unknown
  /** The value before is unknown (an event diff that isn't complete), not empty. */
  oldUnknown?: boolean
}

/** A document with changes, for the review. */
export interface WorkspaceDocumentChange {
  documentAggregateId: string
  /** Null for a deleted document or one only the base workspace has. */
  documentAddress: NodeAddress | null
  siteAggregateId: string | null
  siteLabel: string | null
  label: string
  nodeType: string
  icon: string | null
  /** Labels from the site node down to the document itself. */
  breadcrumb: string[]
  hidden: boolean
  created: boolean
  changed: boolean
  moved: boolean
  deleted: boolean
  /** How many of its nodes changed. */
  changeCount: number
}

/** A changed node of a document's net diff against the base workspace. */
export interface WorkspaceDocumentDiffNode {
  nodeAggregateId: string
  dimensions: Record<string, string>
  status: 'created' | 'removed' | 'moved' | 'changed' | 'variant'
  nodeLabel: string | null
  nodeType: string | null
  icon: string | null
  changes: ValueChange[]
}

/** An event of the pending history, with who made it and where. */
export interface WorkspacePendingEvent extends WorkspaceFeedEvent {
  initiatingUserLabel: string | null
  nodeLabel: string | null
  nodeType: string | null
  icon: string | null
  documentAggregateId: string | null
  documentLabel: string | null
  documentAddress: NodeAddress | null
}

/** A workspace's pending history: the newest events of its content stream. */
export interface WorkspacePendingEvents {
  contentStreamId: string
  /** Where the content stream branched off its base's. */
  forkedFrom: { contentStreamId: string; version: number } | null
  /** Older events exist beyond the listed ones. */
  truncated: boolean
  /** Oldest first. */
  events: WorkspacePendingEvent[]
}

/** An event of an editing step with what it changed. */
export interface WorkspacePendingDiffEvent extends WorkspacePendingEvent {
  changes: ValueChange[]
}

/** A deleted page of the trash. */
export interface WorkspaceTrashItem {
  nodeAggregateId: string
  /** Where to read the deleted node (with includeRemoved). */
  nodeAddress: NodeAddress | null
  label: string
  nodeType: string
  icon: string | null
  /** Labels from the site node down to the deleted page itself. */
  breadcrumb: string[]
  siteAggregateId: string | null
  siteLabel: string | null
  /** The dimension space points it is deleted in. */
  dimensions: Record<string, string>[]
  deletedAt: string | null
  deletedBy: string | null
  /** The deleted ancestors a restore brings back along with it. */
  restoresAncestors: { nodeAggregateId: string; label: string | null }[]
}

/** A conflicting node with its labels and document. */
interface ConflictNodeDetail {
  nodeAggregateId: string
  nodeLabel: string | null
  documentAggregateId: string | null
  documentLabel: string | null
  documentAddress: NodeAddress | null
}

/** How many events the pending history shows. */
const PENDING_EVENTS_LIMIT = 100

/** How many events a root's (live's) lane in the Workspaces graph reads: it
 * draws at most 25 dots, only the newest ones after the earliest fork. */
export const ROOT_EVENTS_LIMIT = 25

/** Neos.Api's maximum page size, and the most ids a filter takes. */
const MAX_PAGE_SIZE = 100

const DOCUMENT_NODE_TYPE = 'Neos.Neos:Document'

function parsePoint(json: string | null | undefined): Record<string, string> {
  if (!json) return {}
  try {
    return JSON.parse(json) as Record<string, string>
  } catch {
    return {}
  }
}

function isRemoved(node: Node): boolean {
  return node.tags.includes('removed') || node.inheritedTags.includes('removed')
}

/** The node's address if it can be navigated to: in the workspace, not deleted. */
function navigableAddress(
  node: Node | null | undefined,
  workspaceName: string,
): NodeAddress | null {
  return node && node.workspaceName === workspaceName && !isRemoved(node)
    ? nodeAddressOf(node)
    : null
}

/** The label of the node's site: its last ancestor (include=…ancestors). */
function siteLabelOf(node: Node | null | undefined): string | null {
  const ancestors = node?.ancestors ?? []
  return ancestors[ancestors.length - 1]?.label ?? null
}

/** Labels from the site node down to the node, from include=…ancestors. */
function breadcrumbOf(node: Node): string[] {
  return [...(node.ancestors ?? [])]
    .reverse()
    .map((ancestor) => ancestor.label)
    .concat(node.label)
}

function iconOf(
  nodeTypes: NodeTypeMap | undefined,
  nodeTypeName: string | null | undefined,
): string | null {
  return (nodeTypeName && nodeTypes?.get(nodeTypeName)?.icon) || null
}

function propertyLabel(
  nodeTypes: NodeTypeMap | undefined,
  nodeTypeName: string | null | undefined,
  name: string,
  kind: 'properties' | 'references',
): string | null {
  const nodeType = nodeTypeName ? nodeTypes?.get(nodeTypeName) : undefined
  return (
    nodeType?.[kind]?.find((declared) => declared.name === name)?.label ?? null
  )
}

/** Labels by labelKey: a node's label differs between dimension space points. */
type Labels = Record<string, string | null>

function labelKey(nodeAggregateId: string, dimensionSpacePoint: string) {
  return `${nodeAggregateId}|${dimensionSpacePoint}`
}

/** The ids a diff names (references, parents), to read their labels. */
function namedIds(diff: ChangeDiff | EventDiff | null | undefined): string[] {
  if (!diff) return []
  return [
    ...diff.references.flatMap((reference) => [
      ...reference.old,
      ...reference.new,
    ]),
    ...(diff.parentAggregateId
      ? [diff.parentAggregateId.old, diff.parentAggregateId.new]
      : []),
  ]
}

/**
 * The labels of the nodes, read in the workspace and each one's dimension
 * space point (deleted ones too), one request per dimension space point;
 * absent for the ones that can't be read.
 */
async function readLabels(
  requests: { nodeAggregateId: string; dimensionSpacePoint: string }[],
  contentRepositoryId: string,
  workspaceName: string,
): Promise<Labels> {
  const idsByPoint = new Map<string, Set<string>>()
  for (const { nodeAggregateId, dimensionSpacePoint } of requests) {
    const ids = idsByPoint.get(dimensionSpacePoint) ?? new Set<string>()
    ids.add(nodeAggregateId)
    idsByPoint.set(dimensionSpacePoint, ids)
  }
  const labels: Labels = {}
  await Promise.all(
    [...idsByPoint].map(async ([dimensionSpacePoint, ids]) => {
      const nodes = await listNodesById(
        contentRepositoryId,
        // none for a node of no dimension space point: the default one
        {
          workspaceName,
          dimensionSpacePoint: dimensionSpacePoint || undefined,
        },
        [...ids],
        { includeRemoved: true },
      ).catch(() => [])
      for (const node of nodes) {
        labels[labelKey(node.nodeAggregateId, dimensionSpacePoint)] = node.label
      }
    }),
  )
  return labels
}

/** The before/after rows of a change's or an event's diff. */
function diffRows(
  diff: ChangeDiff | EventDiff | null | undefined,
  nodeTypeName: string | null | undefined,
  /** Where the diff's node is: the referenced nodes are labelled from there. */
  dimensionSpacePoint: string,
  labels: Labels,
  nodeTypes: NodeTypeMap | undefined,
): ValueChange[] {
  if (!diff) return []
  // An event's diff without the value before (no base workspace to read it
  // from, or the node is older than the events looked back at).
  const unknownBefore = 'complete' in diff && !diff.complete
  const labelled = (id: string): NodeLabel => ({
    id,
    label: labels[labelKey(id, dimensionSpacePoint)] ?? null,
  })
  const rows: ValueChange[] = diff.properties.map((property) => ({
    kind: 'property',
    property: property.name,
    label: propertyLabel(nodeTypes, nodeTypeName, property.name, 'properties'),
    old: property.old,
    new: property.new,
    oldUnknown: unknownBefore && property.old === null,
  }))
  if (diff.nodeType) {
    rows.push({
      kind: 'nodeType',
      property: null,
      label: null,
      old: diff.nodeType.old,
      new: diff.nodeType.new,
    })
  }
  if (diff.name) {
    rows.push({
      kind: 'name',
      property: null,
      label: null,
      old: diff.name.old,
      new: diff.name.new,
    })
  }
  if (diff.parentAggregateId) {
    rows.push({
      kind: 'parent',
      property: null,
      label: null,
      old: labelled(diff.parentAggregateId.old),
      new: labelled(diff.parentAggregateId.new),
    })
  }
  for (const tag of diff.tags?.added ?? []) {
    rows.push({ kind: 'tag', property: tag, label: null, old: null, new: tag })
  }
  for (const tag of diff.tags?.removed ?? []) {
    rows.push({ kind: 'tag', property: tag, label: null, old: tag, new: null })
  }
  for (const reference of diff.references) {
    rows.push({
      kind: 'reference',
      property: reference.name,
      label: propertyLabel(
        nodeTypes,
        nodeTypeName,
        reference.name,
        'references',
      ),
      old: reference.old.map(labelled),
      new: reference.new.map(labelled),
      oldUnknown: unknownBefore && reference.old.length === 0,
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// The review: changes by document, a document's net diff

function documentChanges(
  changes: Change[],
  workspaceName: string,
  nodeTypes: NodeTypeMap | undefined,
): WorkspaceDocumentChange[] {
  const documents = new Map<string, WorkspaceDocumentChange>()
  const changedNodes = new Map<string, Set<string>>()
  for (const change of changes) {
    const id = change.documentAggregateId
    if (id === null) continue
    let document = documents.get(id)
    if (
      document === undefined ||
      (document.nodeType === '' && change.document)
    ) {
      const node = change.document
      document = {
        ...(document ?? {
          created: false,
          changed: false,
          moved: false,
          deleted: false,
          changeCount: 0,
        }),
        documentAggregateId: id,
        documentAddress: navigableAddress(node, workspaceName),
        siteAggregateId: change.siteAggregateId,
        siteLabel: siteLabelOf(node),
        label: node?.label ?? id,
        nodeType: node?.nodeType ?? '',
        icon: iconOf(nodeTypes, node?.nodeType),
        breadcrumb: node ? breadcrumbOf(node) : [],
        hidden: node?.isHidden ?? false,
      }
      documents.set(id, document)
    }
    // The projection has a row per node AND dimension space point
    const nodes = changedNodes.get(id) ?? new Set<string>()
    changedNodes.set(id, nodes)
    if (!nodes.has(change.nodeAggregateId)) {
      nodes.add(change.nodeAggregateId)
      document.changeCount++
    }
    // The document's own change says what happened to the page, any other is
    // content in it that changed.
    if (change.nodeAggregateId === id) {
      document.created ||= change.created
      document.moved ||= change.moved
      document.deleted ||= change.deleted
      document.changed ||= change.changed
    } else {
      document.changed = true
    }
  }
  return [...documents.values()]
}

/**
 * The workspace's changes grouped by their document, for the review dialog:
 * all, or with a site (its site node's aggregate id) the ones in that site.
 */
export function useWorkspaceDocumentChanges(
  workspaceName: string | null,
  siteAggregateId: string | null,
  enabled = true,
) {
  const contentRepositoryId = useActiveContentRepositoryId()
  const { data: nodeTypes } = useNodeTypes()
  const query = useQuery({
    queryKey: neosKeys.workspaces.review(
      contentRepositoryId ?? '',
      workspaceName ?? '',
      siteAggregateId,
    ),
    queryFn: ({ signal }) =>
      fetchWorkspaceChanges(
        contentRepositoryId!,
        workspaceName!,
        {
          filterBySite: siteAggregateId ?? undefined,
          include: 'document.ancestors',
        },
        signal,
      ),
    enabled: workspaceName !== null && contentRepositoryId !== null && enabled,
    // Read afresh whenever the review opens: changes made elsewhere (another
    // tab, a colleague, the classic UI) invalidate nothing here, and a review
    // must never offer a stale "no pending changes".
    staleTime: 0,
  })
  const data = useMemo(
    () =>
      query.data === undefined || workspaceName === null
        ? undefined
        : { documents: documentChanges(query.data, workspaceName, nodeTypes) },
    [query.data, workspaceName, nodeTypes],
  )
  return { ...query, data }
}

function documentDiffNodes(
  changes: Change[],
  labels: Labels,
  nodeTypes: NodeTypeMap | undefined,
): WorkspaceDocumentDiffNode[] {
  const seen = new Set<string>()
  const nodes: WorkspaceDocumentDiffNode[] = []
  for (const change of changes) {
    // Changes to the whole aggregate show in the diffs of its variants
    if (change.originDimensionSpacePoint === null) continue
    const key = `${change.nodeAggregateId}|${change.originDimensionSpacePoint}`
    if (seen.has(key)) continue
    seen.add(key)
    const status: WorkspaceDocumentDiffNode['status'] = change.deleted
      ? 'removed'
      : change.diff?.createdVariant
        ? 'variant'
        : change.created
          ? 'created'
          : change.moved
            ? 'moved'
            : 'changed'
    const rows =
      status === 'removed'
        ? []
        : diffRows(
            change.diff,
            change.node?.nodeType,
            change.originDimensionSpacePoint ?? '',
            labels,
            nodeTypes,
          )
    if (status === 'moved' && !change.diff?.parentAggregateId) {
      rows.push({
        kind: 'position',
        property: null,
        label: null,
        old: null,
        new: null,
      })
    }
    // Edited and changed back: nothing to show
    if (rows.length === 0 && status === 'changed') continue
    nodes.push({
      nodeAggregateId: change.nodeAggregateId,
      dimensions: parsePoint(change.originDimensionSpacePoint),
      status,
      nodeLabel: change.node?.label ?? null,
      nodeType: change.node?.nodeType ?? null,
      icon: iconOf(nodeTypes, change.node?.nodeType),
      changes: rows,
    })
  }
  return nodes
}

/**
 * The net diff of one document's changed nodes (workspace vs base). Lazy:
 * fetched when a review row is unfolded.
 */
export function useWorkspaceDocumentDiff(
  workspaceName: string | null,
  documentAggregateId: string | null,
  enabled = true,
) {
  const contentRepositoryId = useActiveContentRepositoryId()
  const { data: nodeTypes } = useNodeTypes('properties,references')
  const query = useQuery({
    queryKey: neosKeys.workspaces.documentDiff(
      contentRepositoryId ?? '',
      workspaceName ?? '',
      documentAggregateId ?? '',
    ),
    queryFn: async () => {
      const changes = await fetchWorkspaceChanges(
        contentRepositoryId!,
        workspaceName!,
        { filterByDocument: documentAggregateId!, include: 'diff,node' },
      )
      const labels = await readLabels(
        changes.flatMap((change) =>
          namedIds(change.diff).map((nodeAggregateId) => ({
            nodeAggregateId,
            dimensionSpacePoint: change.originDimensionSpacePoint ?? '',
          })),
        ),
        contentRepositoryId!,
        workspaceName!,
      )
      return { changes, labels }
    },
    enabled:
      enabled &&
      workspaceName !== null &&
      documentAggregateId !== null &&
      contentRepositoryId !== null,
    // State diffs go stale with further edits.
    staleTime: 10_000,
  })
  const data = useMemo(
    () =>
      query.data === undefined
        ? undefined
        : {
            nodes: documentDiffNodes(
              query.data.changes,
              query.data.labels,
              nodeTypes,
            ),
          },
    [query.data, nodeTypes],
  )
  return { ...query, data }
}

// ---------------------------------------------------------------------------
// The pending history: events, editing steps, their diffs

function pendingEvent(
  feedEvent: WorkspaceFeedEvent,
  event: Event,
  workspaceName: string,
  users: Map<string, string>,
  nodeTypes: NodeTypeMap | undefined,
): WorkspacePendingEvent {
  return {
    ...feedEvent,
    initiatingUserLabel:
      feedEvent.initiatingUserId !== null
        ? (users.get(feedEvent.initiatingUserId) ?? null)
        : null,
    nodeLabel: event.node?.label ?? null,
    nodeType: event.node?.nodeType ?? null,
    icon: iconOf(nodeTypes, event.node?.nodeType),
    documentAggregateId: event.document?.nodeAggregateId ?? null,
    documentLabel: event.document?.label ?? null,
    documentAddress: navigableAddress(event.document, workspaceName),
  }
}

function useUserLabels(): Map<string, string> {
  const { data: users } = useUsers()
  return useMemo(
    () => new Map((users ?? []).map((user) => [user.id, user.label])),
    [users],
  )
}

/** A listing of pending events (newest first) as a pending history. */
function pendingEventsOf(
  listing: PaginatedEventListing,
  workspaceName: string,
  users: Map<string, string>,
  nodeTypes: NodeTypeMap | undefined,
): WorkspacePendingEvents {
  return {
    contentStreamId: listing.meta.contentStreamId,
    forkedFrom: listing.meta.forkedFrom,
    truncated: listing.links.next !== null,
    events: [...listing.data].reverse().flatMap((event) => {
      const feedEvent = parseFeedEvent(event)
      return feedEvent
        ? [pendingEvent(feedEvent, event, workspaceName, users, nodeTypes)]
        : []
    }),
  }
}

/**
 * The pending histories of several workspaces at once (the Workspaces graph
 * fetches one per visible branch), by workspace name; entries are absent
 * while loading or on error. The roots' (rootNames) read only their newest
 * ROOT_EVENTS_LIMIT events.
 */
export function useWorkspacesPendingEvents(
  workspaceNames: string[],
  rootNames: ReadonlySet<string>,
  enabled = true,
  refetchInterval?: number,
) {
  const contentRepositoryId = useActiveContentRepositoryId()
  const { data: nodeTypes } = useNodeTypes()
  const users = useUserLabels()
  // Callers pass a fresh array every render: key the names by content, so
  // combine (and with it the combined result) only changes with them.
  const namesKey = JSON.stringify(workspaceNames)
  const names = useMemo(() => JSON.parse(namesKey) as string[], [namesKey])
  const combine = useCallback(
    (results: { data?: PaginatedEventListing; isLoading: boolean }[]) => {
      const byWorkspace = new Map<string, WorkspacePendingEvents>()
      results.forEach((result, index) => {
        // One query per name, in the same order.
        const workspaceName = names[index]
        if (!result.data || workspaceName === undefined) return
        byWorkspace.set(
          workspaceName,
          pendingEventsOf(result.data, workspaceName, users, nodeTypes),
        )
      })
      return {
        byWorkspace,
        isLoading: results.some((result) => result.isLoading),
      }
    },
    [names, users, nodeTypes],
  )
  return useQueries({
    queries: names.map((workspaceName) => {
      const limit = rootNames.has(workspaceName)
        ? ROOT_EVENTS_LIMIT
        : PENDING_EVENTS_LIMIT
      return {
        queryKey: neosKeys.workspaces.pendingEvents(
          contentRepositoryId ?? '',
          workspaceName,
          limit,
        ),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          listWorkspaceEvents(
            workspaceName,
            { sort: '-sequenceNumber', limit, include: 'node,document' },
            contentRepositoryId!,
            signal,
          ),
        enabled: enabled && contentRepositoryId !== null,
        refetchInterval,
      }
    }),
    combine,
  })
}

/**
 * The pending history of one document in the workspace: the newest events
 * about the document itself and its content (filterByDocument).
 */
export function useDocumentPendingEvents(
  workspaceName: string | null,
  documentAggregateId: string | null,
) {
  const contentRepositoryId = useActiveContentRepositoryId()
  const { data: nodeTypes } = useNodeTypes()
  const users = useUserLabels()
  const query = useQuery({
    queryKey: neosKeys.workspaces.documentEvents(
      contentRepositoryId ?? '',
      workspaceName ?? '',
      documentAggregateId ?? '',
    ),
    queryFn:
      workspaceName !== null &&
      documentAggregateId !== null &&
      contentRepositoryId !== null
        ? ({ signal }) =>
            listWorkspaceEvents(
              workspaceName,
              {
                sort: '-sequenceNumber',
                limit: PENDING_EVENTS_LIMIT,
                include: 'node,document',
                filterByDocument: documentAggregateId,
              },
              contentRepositoryId,
              signal,
            )
        : skipToken,
  })
  const data = useMemo(
    () =>
      query.data === undefined || workspaceName === null
        ? undefined
        : pendingEventsOf(query.data, workspaceName, users, nodeTypes),
    [query.data, workspaceName, users, nodeTypes],
  )
  return { ...query, data }
}

/** The rows of an event that its diff has no field for. */
function eventRows(event: Event): ValueChange[] {
  const payload = event.payload ?? {}
  if (
    event.type === 'NodeAggregateWasMoved' &&
    !event.diff?.parentAggregateId
  ) {
    return [
      { kind: 'position', property: null, label: null, old: null, new: null },
    ]
  }
  if (
    event.type === 'NodeSpecializationVariantWasCreated' ||
    event.type === 'NodeGeneralizationVariantWasCreated' ||
    event.type === 'NodePeerVariantWasCreated'
  ) {
    return [
      {
        kind: 'variant',
        property: null,
        label: null,
        old: payload.sourceOrigin ?? null,
        new:
          payload.specializationOrigin ??
          payload.generalizationOrigin ??
          payload.peerOrigin ??
          null,
      },
    ]
  }
  return []
}

/**
 * Before/after detail for one editing step (a sequence-number range of the
 * pending history). Lazy: fetched when a step's detail is opened.
 */
export function useWorkspacePendingEventsDiff(
  workspaceName: string | null,
  from: number | null,
  to: number | null,
) {
  const contentRepositoryId = useActiveContentRepositoryId()
  const { data: nodeTypes } = useNodeTypes('properties,references')
  const users = useUserLabels()
  const query = useQuery({
    queryKey: neosKeys.workspaces.eventsDiff(
      contentRepositoryId ?? '',
      workspaceName ?? '',
      from ?? 0,
      to ?? 0,
    ),
    queryFn: async () => {
      const events: Event[] = []
      let after = from! - 1
      for (;;) {
        const page = await listWorkspaceEvents(
          workspaceName!,
          { after, limit: PENDING_EVENTS_LIMIT, include: 'diff,node,document' },
          contentRepositoryId!,
        )
        const inRange = page.data.filter((event) => event.sequenceNumber <= to!)
        events.push(...inRange)
        if (inRange.length < page.data.length || page.data.length === 0) break
        // page.data is not empty: the loop broke out above otherwise.
        after = page.data[page.data.length - 1]!.sequenceNumber
        if (after >= to!) break
      }
      const labels = await readLabels(
        events.flatMap((event) =>
          namedIds(event.diff).map((nodeAggregateId) => ({
            nodeAggregateId,
            dimensionSpacePoint: event.node?.dimensionSpacePoint ?? '',
          })),
        ),
        contentRepositoryId!,
        workspaceName!,
      )
      return { events, labels }
    },
    enabled:
      workspaceName !== null &&
      contentRepositoryId !== null &&
      from !== null &&
      to !== null,
    // The range is immutable (events never change once recorded); only a
    // stream swap invalidates it, and that changes the key via from/to.
    staleTime: Infinity,
  })
  const data = useMemo(() => {
    if (query.data === undefined || workspaceName === null) return undefined
    const { events, labels } = query.data
    return {
      events: events.flatMap((event): WorkspacePendingDiffEvent[] => {
        const feedEvent = parseFeedEvent(event)
        if (!feedEvent) return []
        return [
          {
            ...pendingEvent(feedEvent, event, workspaceName, users, nodeTypes),
            changes: [
              ...diffRows(
                event.diff,
                event.node?.nodeType,
                event.node?.dimensionSpacePoint ?? '',
                labels,
                nodeTypes,
              ),
              ...eventRows(event),
            ],
          },
        ]
      }),
    }
  }, [query.data, workspaceName, users, nodeTypes])
  return { ...query, data }
}

// ---------------------------------------------------------------------------
// The trash

interface Deletion {
  at: string
  userId: string | null
}

interface TrashData {
  changes: Change[]
  deletions: Record<string, Deletion>
}

/**
 * When and by whom the nodes were deleted: their newest SubtreeWasTagged
 * "removed" event in the workspace's content stream - an unpublished deletion
 * is there. The events are filtered by the server, so a page of them is
 * usually all it takes: one request per 100 nodes (the most the filter
 * takes), another page only when they have more removals between them than
 * a page holds (deleted in several dimension space points, or again after a
 * restore).
 */
async function findDeletions(
  contentRepositoryId: string,
  workspaceName: string,
  nodeAggregateIds: string[],
  signal?: AbortSignal,
): Promise<Record<string, Deletion>> {
  const deletions: Record<string, Deletion> = {}
  const chunks: string[][] = []
  for (let i = 0; i < nodeAggregateIds.length; i += MAX_PAGE_SIZE) {
    chunks.push(nodeAggregateIds.slice(i, i + MAX_PAGE_SIZE))
  }
  await Promise.all(
    chunks.map(async (ids) => {
      let after: number | undefined
      for (;;) {
        const listing = await listWorkspaceEvents(
          workspaceName,
          {
            filterByTag: 'removed',
            filterByEventType: 'SubtreeWasTagged',
            filterByNodeAggregateId: ids.join(','),
            sort: '-sequenceNumber',
            limit: MAX_PAGE_SIZE,
            after,
          },
          contentRepositoryId,
          signal,
        )
        for (const event of listing.data) {
          const id = event.payload?.nodeAggregateId
          if (typeof id !== 'string' || deletions[id] !== undefined) continue
          const userId = event.metadata?.initiatingUserId
          deletions[id] = {
            at:
              typeof event.metadata?.initiatingTimestamp === 'string'
                ? event.metadata.initiatingTimestamp
                : event.recordedAt,
            userId: typeof userId === 'string' ? userId : null,
          }
        }
        const next = nextEventsAfter(listing)
        if (ids.every((id) => deletions[id] !== undefined) || next === null) {
          return
        }
        after = next
      }
    }),
  )
  return deletions
}

/** The deleted ancestors a restore of the node brings back along with it. */
function deletedAncestors(node: Node | null) {
  return (node?.ancestors ?? [])
    .filter((ancestor) => ancestor.tags.includes('removed'))
    .map((ancestor) => ({
      nodeAggregateId: ancestor.nodeAggregateId,
      label: ancestor.label,
    }))
}

function trashItems(
  data: TrashData,
  workspaceName: string,
  users: Map<string, string>,
  nodeTypes: NodeTypeMap | undefined,
): WorkspaceTrashItem[] {
  const items = new Map<string, WorkspaceTrashItem>()
  for (const change of data.changes) {
    const node = change.node
    // Deleted itself, not only inside a deleted ancestor
    if (node && !node.tags.includes('removed')) continue
    const point = parsePoint(change.originDimensionSpacePoint)
    const existing = items.get(change.nodeAggregateId)
    if (existing) {
      existing.dimensions.push(point)
      continue
    }
    const deletion = data.deletions[change.nodeAggregateId]
    items.set(change.nodeAggregateId, {
      nodeAggregateId: change.nodeAggregateId,
      nodeAddress:
        node && node.workspaceName === workspaceName
          ? nodeAddressOf(node)
          : null,
      label: node?.label ?? change.nodeAggregateId,
      nodeType: node?.nodeType ?? '',
      icon: iconOf(nodeTypes, node?.nodeType),
      breadcrumb: node ? breadcrumbOf(node) : [],
      siteAggregateId: change.siteAggregateId,
      siteLabel: siteLabelOf(node),
      dimensions: [point],
      deletedAt: deletion?.at ?? null,
      deletedBy:
        deletion?.userId != null ? (users.get(deletion.userId) ?? null) : null,
      restoresAncestors: deletedAncestors(node),
    })
  }
  // Newest deletion first
  return [...items.values()].sort((a, b) =>
    (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''),
  )
}

/**
 * The workspace's deleted PAGES - all, or with a site (its site node's
 * aggregate id) the ones in that site. Deleted content elements are left out:
 * they are restored where they are edited.
 */
export function useWorkspaceTrash(
  workspaceName: string | null,
  siteAggregateId: string | null,
) {
  const contentRepositoryId = useActiveContentRepositoryId()
  const { data: nodeTypes } = useNodeTypes()
  const users = useUserLabels()
  const query = useQuery({
    queryKey: neosKeys.workspaces.trash(
      contentRepositoryId ?? '',
      workspaceName ?? '',
      siteAggregateId,
    ),
    queryFn: async ({ signal }): Promise<TrashData> => {
      const changes = await fetchWorkspaceChanges(
        contentRepositoryId!,
        workspaceName!,
        {
          filterByChangeType: 'deleted',
          filterByNodeType: DOCUMENT_NODE_TYPE,
          filterBySite: siteAggregateId ?? undefined,
          include: 'node.ancestors',
        },
        signal,
      )
      const deletions = await findDeletions(
        contentRepositoryId!,
        workspaceName!,
        [...new Set(changes.map((change) => change.nodeAggregateId))],
        signal,
      )
      return { changes, deletions }
    },
    enabled: workspaceName !== null && contentRepositoryId !== null,
  })
  const data = useMemo(
    () =>
      query.data === undefined || workspaceName === null
        ? undefined
        : { items: trashItems(query.data, workspaceName, users, nodeTypes) },
    [query.data, workspaceName, users, nodeTypes],
  )
  return { ...query, data }
}

/**
 * Restores a deleted node of the trash (Neos.Api's restoreNode), together
 * with any deleted ancestor it lives inside. A 409 while the workspace is
 * outdated or when the node is not deleted itself - the problem's detail says
 * which. Resolves with what was restored, taken from the trash listing the
 * restore was offered from.
 */
export async function restoreFromTrash(
  workspaceName: string,
  nodeAggregateId: string,
): Promise<{ nodeAggregateId: string; label: string | null }[]> {
  const contentRepositoryId = activeContentRepositoryId()
  // The listing of whichever site the trash was offered for
  const node =
    queryClient
      .getQueriesData<TrashData>({
        queryKey: neosKeys.workspaces.trashes(
          contentRepositoryId,
          workspaceName,
        ),
      })
      .flatMap(([, data]) => data?.changes ?? [])
      .find((change) => change.nodeAggregateId === nodeAggregateId)?.node ??
    null
  await restoreNode({ contentRepositoryId, workspaceName, nodeAggregateId })
  return [
    { nodeAggregateId, label: node?.label ?? null },
    ...deletedAncestors(node),
  ]
}

// ---------------------------------------------------------------------------
// Conflicts

/**
 * The conflicting nodes of a failed rebase or publish with their labels and
 * documents - Neos.Api names them by id only. Read in the dimension space
 * point being edited, in the workspace (deleted ones too), else in its base.
 */
export function useConflictDetails(
  workspaceName: string | null,
  conflicts: { nodeAggregateId: string; documentAggregateId: string | null }[],
) {
  const contentRepositoryId = useActiveContentRepositoryId()
  const { dimensionSpacePoint } = useStudio()
  const unique = [
    ...new Map(
      conflicts.map((conflict) => [conflict.nodeAggregateId, conflict]),
    ).values(),
  ].sort((a, b) => a.nodeAggregateId.localeCompare(b.nodeAggregateId))
  return useQuery({
    queryKey: neosKeys.workspaces.conflicts(
      contentRepositoryId ?? '',
      workspaceName ?? '',
      dimensionSpacePoint ?? '',
      unique.map(
        (conflict) =>
          `${conflict.nodeAggregateId}|${conflict.documentAggregateId ?? ''}`,
      ),
    ),
    queryFn: async ({ signal }): Promise<ConflictNodeDetail[]> => {
      const baseWorkspaceName =
        queryClient
          .getQueryData<Workspace[]>(
            neosKeys.workspaces.list(contentRepositoryId!),
          )
          ?.find((workspace) => workspace.name === workspaceName)
          ?.baseWorkspaceName ?? null
      const ids = new Set(
        unique.flatMap(({ nodeAggregateId, documentAggregateId }) =>
          documentAggregateId !== null
            ? [nodeAggregateId, documentAggregateId]
            : [nodeAggregateId],
        ),
      )
      // One batch in the workspace, then one in its base for the misses
      const nodes = new Map<string, Node>()
      for (const name of [workspaceName!, baseWorkspaceName]) {
        const missing = [...ids].filter((id) => !nodes.has(id))
        if (name === null || missing.length === 0) continue
        const read = await listNodesById(
          contentRepositoryId!,
          {
            workspaceName: name,
            dimensionSpacePoint: dimensionSpacePoint || undefined,
          },
          missing,
          { includeRemoved: true },
          signal,
        ).catch(() => [])
        for (const node of read) nodes.set(node.nodeAggregateId, node)
      }
      return unique.map(({ nodeAggregateId, documentAggregateId }) => {
        const document =
          documentAggregateId !== null ? nodes.get(documentAggregateId) : null
        return {
          nodeAggregateId,
          nodeLabel: nodes.get(nodeAggregateId)?.label ?? null,
          documentAggregateId,
          documentLabel: document?.label ?? null,
          documentAddress: navigableAddress(document, workspaceName!),
        }
      })
    },
    enabled:
      workspaceName !== null &&
      contentRepositoryId !== null &&
      unique.length > 0,
    staleTime: Infinity,
  })
}
