import * as React from 'react'
import type { Node, NodeAddress, Site } from '@/api/neos/schema'
import { useLatestRef } from '@/hooks/use-latest-ref'

/**
 * Studio's event bus: what happened in the shell, for code that wants to
 * react to it - plugins first of all (a panel refreshing its own data after a
 * publish, an analytics hook on saves). useStudio() says what IS; these say
 * what HAPPENED, each emitted once, at the one place the shell knows it for
 * sure (the save that succeeded, the publish mutation's success, the change
 * feed's classification) rather than derived from re-renders.
 *
 * Emitting never holds up the shell: handlers run in a microtask after the
 * emitting code has finished, each on its own - one that throws (or rejects)
 * is logged with the event's name and the others still run. Nothing waits
 * for a handler, so a handler cannot slow down or veto the flow it hears
 * about.
 *
 * The payloads are part of the plugin API (see StudioEventMap): additive
 * changes only.
 */

/**
 * Identifies a workspace: a NodeAddress (or a Node) is one, so either can be
 * passed wherever a workspace is asked for.
 */
export interface WorkspaceRef {
  contentRepositoryId: string
  workspaceName: string
}

/**
 * What a local structural edit did - 'restored' is a restore from the
 * trash (the node plus any deleted ancestor it lives in).
 */
export type StructureChange =
  | 'created'
  | 'copied'
  | 'moved'
  | 'deleted'
  | 'hidden'
  | 'unhidden'
  | 'typeChanged'
  | 'restored'

/** Every event by name, with its payload. */
export interface StudioEventMap {
  /**
   * A property or the references of a node were saved by this editor - from
   * the inspector or inline in the preview (typing saves in bursts, one
   * event per save that reached the server). `address` is the node as
   * written: in the viewed dimension space point (a shine-through node was
   * varied there first).
   */
  'node.edited': {
    address: NodeAddress
    kind: 'property' | 'references'
    /** The property or reference name. */
    name: string
  }
  /**
   * Nodes were created, copied, moved, deleted, hidden/unhidden, retyped or
   * restored by this editor. For a batch that failed halfway, the nodes
   * written before the failure. `nodeAggregateIds` are the nodes acted on
   * (for 'created' and 'copied' the new nodes; a restore names the restored
   * node first, then its restored ancestors).
   */
  'nodes.structureChanged': WorkspaceRef & {
    change: StructureChange
    nodeAggregateIds: string[]
  }
  /** This editor published a workspace (all of it, or a site or documents of it). */
  'workspace.published': WorkspaceRef
  /** This editor discarded a workspace's changes (all, or a site's or documents'). */
  'workspace.discarded': WorkspaceRef
  /**
   * This editor rebased a workspace: synchronized it with its base
   * (`newBaseWorkspaceName` null), or moved it onto another base.
   */
  'workspace.rebased': WorkspaceRef & { newBaseWorkspaceName: string | null }
  /**
   * The workspace being edited changed (personal <-> a shared one), or was
   * resolved at startup (`previousWorkspaceName` null).
   */
  'workspace.switched': {
    workspaceName: string
    previousWorkspaceName: string | null
  }
  /** Another site was opened, or the first one resolved (`previousSite` null). */
  'site.switched': { site: Site; previousSite: Site | null }
  /** The viewed dimension space point (JSON, as in a NodeAddress) changed. */
  'dimension.switched': {
    dimensionSpacePoint: string
    previousDimensionSpacePoint: string | null
  }
  /**
   * The selected document changed - another document, or the same one
   * followed into another workspace or dimension. null: none (any more).
   */
  'document.selected': { node: Node | null }
  /** The inspected node changed (as document.selected; a document or content). */
  'node.inspected': { node: Node | null }
  /**
   * Collaborators changed the shared workspace being edited, as the change
   * feed reports it - only while a shared workspace is the editing context
   * (personal workspaces have no feed), and only for the viewed dimension.
   * 'content': properties/references of `nodeAggregateIds`; 'structure':
   * nodes created/moved/removed/retagged (no ids - refresh broadly);
   * 'wholesale': the workspace was published, discarded or rebased, or the
   * feed missed a window.
   */
  'remote.changed': WorkspaceRef & {
    kind: 'content' | 'structure' | 'wholesale'
    nodeAggregateIds: string[]
  }
}

export type StudioEventName = keyof StudioEventMap

export type StudioEventHandler<Name extends StudioEventName> = (
  payload: StudioEventMap[Name],
) => void

/** The listening side of the bus - what plugins get as `events`. */
export interface StudioEvents {
  /** Listen to an event; returns the unsubscriber. */
  on<Name extends StudioEventName>(
    name: Name,
    handler: StudioEventHandler<Name>,
  ): () => void
}

/**
 * One subscription. Wrapped, so the same function subscribed twice is two
 * subscriptions, each removed by its own unsubscriber.
 */
interface Subscription {
  handler: StudioEventHandler<StudioEventName>
}

const subscriptionsByName = new Map<StudioEventName, Set<Subscription>>()

export const studioEvents: StudioEvents = {
  on(name, handler) {
    const subscription: Subscription = {
      handler: handler as StudioEventHandler<StudioEventName>,
    }
    let subscriptions = subscriptionsByName.get(name)
    if (!subscriptions) {
      subscriptions = new Set()
      subscriptionsByName.set(name, subscriptions)
    }
    subscriptions.add(subscription)
    return () => {
      subscriptionsByName.get(name)?.delete(subscription)
    }
  },
}

function reportHandlerError(name: StudioEventName, error: unknown): void {
  console.error(`Handler of the Studio event "${name}" threw:`, error)
}

/**
 * Announce an event. Returns at once: the handlers registered now run in a
 * microtask (one unsubscribed meanwhile is skipped), isolated from each
 * other and from the caller.
 */
export function emitStudioEvent<Name extends StudioEventName>(
  name: Name,
  payload: StudioEventMap[Name],
): void {
  const subscriptions = subscriptionsByName.get(name)
  if (!subscriptions || subscriptions.size === 0) return
  const snapshot = [...subscriptions]
  queueMicrotask(() => {
    for (const subscription of snapshot) {
      if (!subscriptions.has(subscription)) continue
      try {
        const result: unknown = subscription.handler(payload)
        // An async handler's rejection is its throw - log it the same way
        // instead of leaving an unhandled rejection.
        if (result instanceof Promise) {
          result.catch((error: unknown) => reportHandlerError(name, error))
        }
      } catch (error) {
        reportHandlerError(name, error)
      }
    }
  })
}

/**
 * Listen to a Studio event for the lifetime of the calling component. The
 * subscription stays put while the handler always sees the latest render's
 * closures (as useKeyboardShortcut does) - an inline arrow function is fine.
 */
export function useStudioEvent<Name extends StudioEventName>(
  name: Name,
  handler: StudioEventHandler<Name>,
): void {
  const latest = useLatestRef(handler)
  React.useEffect(
    () => studioEvents.on(name, (payload) => latest.current(payload)),
    [name, latest], // latest: a stable ref
  )
}
