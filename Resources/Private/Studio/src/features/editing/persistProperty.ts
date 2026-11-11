import { isConflict } from '@/api/http/errors'
import {
  createNodeVariant,
  setNodeProperties,
  setNodeReferences,
} from '@/api/neos/endpoints/nodeCommands'
import { fetchAncestors, fetchNode, getNode } from '@/api/neos/endpoints/nodes'
import { fetchNodeType } from '@/api/neos/endpoints/nodeTypes'
import { neosKeys } from '@/api/neos/keys'
import {
  type Node,
  type NodeAddress,
  nodeAddressKey,
  type NodeType,
  nodeTypeConfiguration,
} from '@/api/neos/schema'
import { emitStudioEvent } from '@/app/events'
import { queryClient } from '@/app/queryClient'
import {
  type HistoryEntry,
  recordHistory,
  UndoConflictError,
} from '@/features/history/historyStore'
import { validateValue } from '@/features/inspector/validators'
import { locatedAt } from '@/features/history/location'
import { invalidateAfterContentEdit } from '@/features/workspaces/invalidate'
import { translate as t } from '@/lib/i18n'

/**
 * An edit refused before it was sent: the value fails the property's
 * configured validation. The message lists the validators' errors.
 */
export class PropertyValidationError extends Error {
  constructor(
    readonly property: string,
    readonly errors: string[],
  ) {
    super(errors.join(' '))
    this.name = 'PropertyValidationError'
  }
}

/**
 * Validates an edit against the property's (or reference's) validation
 * configuration, read from the node type - every write path runs through
 * here, inline editing as well as the inspector. Both the node and its type
 * are usually cached already (the node is selected, its type inspected);
 * they are only read when not.
 */
async function validateEdit(
  address: NodeAddress,
  name: string,
  value: unknown,
): Promise<{ node: Node; nodeType: NodeType }> {
  const node = await queryClient.ensureQueryData({
    queryKey: neosKeys.nodes.get(address),
    queryFn: () => getNode(address, { include: 'hasChildren' }),
  })
  const nodeType = await fetchNodeType(
    address.contentRepositoryId,
    node.nodeType,
  )
  const configuration = nodeTypeConfiguration(nodeType)
  const validation =
    configuration.properties?.[name]?.validation ??
    configuration.references?.[name]?.validation
  const errors = validateValue(value, validation)
  if (errors.length > 0) throw new PropertyValidationError(name, errors)
  return { node, nodeType }
}

/**
 * Materializes a shine-through node in its viewed dimension, outermost-first:
 * wrapping nodes must exist in the dimension before the nodes inside them, so
 * every shine-through regular ancestor (the document, then containers - their
 * tethered collections vary along automatically) is varied top-down before
 * the node itself. Neos.Api only varies the ancestors missing in the
 * dimension, not the ones shining through, hence the walk here. A tethered
 * node with nothing else shining through is varied as it is - the server
 * varies its nearest non-tethered ancestor with it. Resolves with whether
 * anything was varied - false when the node already originates in the viewed
 * dimension.
 */
async function varyShineThrough(node: Node): Promise<boolean> {
  if (!node.isShineThrough) return false
  const chain = [...(await fetchAncestors(node))].reverse()
  chain.push(node)
  const regular = chain.filter(
    (n) => n.classification === 'regular' && n.isShineThrough,
  )
  const nodesToVary = regular.length > 0 ? regular : [node]
  // One after the other: each variant needs its parent's in place.
  for (const n of nodesToVary) {
    await createNodeVariant(n, n.dimensionSpacePoint)
  }
  return true
}

/**
 * The shared write path for node edits (properties and references). The
 * write goes out directly; only its documented 409 - the node shines through
 * from another dimension - makes it create the variants at the viewed
 * dimension first, wrapping ancestors before the edited node (see
 * varyShineThrough), and retry, so the edit never writes through to the
 * other variant.
 */
async function withVariantHandling<T>(
  address: NodeAddress,
  write: () => Promise<T>,
): Promise<T> {
  let result: T
  try {
    result = await write()
  } catch (error) {
    if (!isConflict(error)) throw error
    const node = await getNode(address)
    if (!node.isShineThrough) throw error
    try {
      await varyShineThrough(node)
      return await write()
    } finally {
      // Also after a failure halfway: some variants may exist by now.
      await invalidateAfterVariation(address)
    }
  }
  // Refresh the pending-changes badges - right away, the editor expects the
  // dirty marker of a first edit at once. Naming the node lets repeated edits
  // of an already changed node skip the full pending-changes refetch.
  void invalidateAfterContentEdit(
    address.contentRepositoryId,
    address.workspaceName,
    [address],
  )
  return result
}

/**
 * Explicitly materializes a shine-through node in the viewed dimension (the
 * preview's "Create variant" button), wrapping ancestors first - the same
 * variant creation an edit would run implicitly, just without an edit.
 * No-op when the node already originates in the viewed dimension.
 */
export async function createVariant(address: NodeAddress): Promise<void> {
  const node = await fetchNode(address)
  let varied: boolean
  try {
    varied = await varyShineThrough(node)
  } catch (error) {
    // Some variants may exist by now.
    await invalidateAfterVariation(address)
    throw error
  }
  if (varied) await invalidateAfterVariation(address)
}

async function invalidateAfterVariation(address: NodeAddress): Promise<void> {
  // A new variant changes coverage throughout the workspace - drop its node
  // reads.
  await queryClient.invalidateQueries({
    queryKey: neosKeys.nodes.workspace(
      address.contentRepositoryId,
      address.workspaceName,
    ),
  })
  // Refresh the pending-changes badges.
  void invalidateAfterContentEdit(
    address.contentRepositoryId,
    address.workspaceName,
  )
}

/**
 * Puts the node a write answered with into the cached reads of the node
 * itself (the get keys, whatever their filter) - no refetch needed. What the
 * reads included beyond it (hasChildren) is kept.
 */
function cacheNode(address: NodeAddress, node: Node): void {
  queryClient.setQueriesData<Node>(
    {
      queryKey: neosKeys.nodes.node(address),
      predicate: (query) =>
        query.queryKey.length === neosKeys.nodes.get(address).length &&
        typeof query.queryKey[query.queryKey.length - 1] === 'object',
    },
    (cached) => (cached ? { ...cached, ...node } : cached),
  )
}

/** How an edit goes into the undo history. */
export interface HistoryOptions {
  /** false: an undo/redo writing - it is not an edit of its own. */
  record?: boolean
  /** Merge into the previous entry if it edited the same property just now. */
  merge?: boolean
}

/** Saves of the same property this close together are one undo step. */
const MERGE_WINDOW_MS = 3000

/**
 * A value as it is written back: properties read assets as {id, url}, but
 * are written as {id} (also in a list).
 */
function writableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(writableValue)
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value)
    const id = (value as { id?: unknown }).id
    if (
      typeof id === 'string' &&
      keys.every((key) => key === 'id' || key === 'url')
    ) {
      return { id }
    }
  }
  return value ?? null
}

/** Compares written values, independent of the order of object keys. */
function sameValue(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value !== null && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [
                key,
                canonical((value as Record<string, unknown>)[key]),
              ]),
          )
        : value
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

/** What a property's or reference's history entry calls it. */
function editLabel(nodeType: NodeType, node: Node, name: string): () => string {
  const declared =
    nodeType.properties?.find((property) => property.name === name)?.label ??
    nodeType.references?.find((reference) => reference.name === name)?.label
  const fieldLabel = declared || name
  const nodeLabel = node.label
  return () => t('undo.edit', 'Change “{0}” of “{1}”', [fieldLabel, nodeLabel])
}

/** Undoing must not overwrite what someone changed since. */
function assertUnchanged(
  current: unknown,
  expected: unknown,
  label: () => string,
): void {
  if (!sameValue(current, expected)) {
    throw new UndoConflictError(
      t(
        'undo.changedMeanwhile',
        'Someone changed it again since, so it was left as it is: {0}',
        [label()],
      ),
    )
  }
}

/** The value history entries of property edits restore, by entry. */
const propertyEdits = new WeakMap<
  HistoryEntry,
  { key: string; before: unknown }
>()

function propertyHistoryEntry(
  address: NodeAddress,
  property: string,
  before: unknown,
  after: unknown,
  label: () => string,
  where: HistoryEntry['where'],
): HistoryEntry {
  const write = async (expected: unknown, value: unknown) => {
    const node = await getNode(address)
    assertUnchanged(writableValue(node.properties[property]), expected, label)
    await persistPropertyChange(address, property, value, { record: false })
  }
  const entry: HistoryEntry = {
    workspace: address,
    label,
    undo: () => write(after, before),
    redo: () => write(before, after),
    where,
  }
  propertyEdits.set(entry, {
    key: `${nodeAddressKey(address)}\0${property}`,
    before,
  })
  return entry
}

/** Persists a property edit (inline or from the inspector). */
export async function persistPropertyChange(
  address: NodeAddress,
  property: string,
  value: unknown,
  history: HistoryOptions = {},
): Promise<void> {
  const { node: edited, nodeType } = await validateEdit(
    address,
    property,
    value,
  )
  // What the node had - read before the write, from the cached node the
  // validation read (the edited node is selected, its reads kept fresh).
  const before = writableValue(edited.properties[property])
  const node = await withVariantHandling(address, () =>
    setNodeProperties(address, { [property]: value }),
  )
  cacheNode(address, node)
  emitStudioEvent('node.edited', { address, kind: 'property', name: property })

  const after = writableValue(value)
  if (history.record === false || sameValue(before, after)) return
  const label = editLabel(nodeType, edited, property)
  const key = `${nodeAddressKey(address)}\0${property}`
  recordHistory(
    propertyHistoryEntry(
      address,
      property,
      before,
      after,
      label,
      locatedAt(address),
    ),
    {
      mergeWith: history.merge
        ? (newest, recordedAt) => {
            const previous = propertyEdits.get(newest)
            if (
              previous?.key !== key ||
              Date.now() - recordedAt > MERGE_WINDOW_MS
            ) {
              return null
            }
            return propertyHistoryEntry(
              address,
              property,
              previous.before,
              after,
              label,
              newest.where,
            )
          }
        : undefined,
    },
  )
}

// Serialization state of the queued variant below, keyed per property.
const queuedValues = new Map<string, unknown>()
const runningChains = new Map<string, Promise<void>>()

async function runPersistChain(
  key: string,
  address: NodeAddress,
  property: string,
): Promise<void> {
  try {
    while (queuedValues.has(key)) {
      const value = queuedValues.get(key)
      queuedValues.delete(key)
      // One undo step per typing burst, not per save.
      await persistPropertyChange(address, property, value, { merge: true })
    }
  } catch (error) {
    // Don't replay values queued behind a failure - they would race the
    // user's next attempt; the caller surfaces the error.
    queuedValues.delete(key)
    throw error
  } finally {
    runningChains.delete(key)
  }
}

/**
 * persistPropertyChange for rapid-fire sources (the debounced inline commits
 * while typing): saves of the same property never overlap - while one request
 * runs, newer values coalesce into a single follow-up save carrying only the
 * latest state (the same discipline the classic UI's changes saga applies).
 */
export function persistPropertyChangeQueued(
  address: NodeAddress,
  property: string,
  value: unknown,
): Promise<void> {
  const key = `${nodeAddressKey(address)}\0${property}`
  queuedValues.set(key, value)
  let chain = runningChains.get(key)
  if (!chain) {
    chain = runPersistChain(key, address, property)
    runningChains.set(key, chain)
  }
  return chain
}

/**
 * Persists a reference edit (reference/references-typed "properties"). The
 * reference name is the property name; the given targets replace the
 * previously set ones - an empty list clears the reference (the CR's
 * "writing no references deletes the previous ones" semantics).
 */
export async function persistReferenceChange(
  address: NodeAddress,
  referenceName: string,
  targets: string[],
  history: HistoryOptions = {},
): Promise<void> {
  const { node: edited, nodeType } = await validateEdit(
    address,
    referenceName,
    // The reference editors' value: one id, or the list of them.
    targets.length === 0 ? null : targets,
  )
  // The node read for the validation may not include its references.
  const before =
    history.record === false
      ? []
      : await currentReferenceTargets(address, referenceName)
  await withVariantHandling(address, () =>
    setNodeReferences(address, { [referenceName]: targets }),
  )
  emitStudioEvent('node.edited', {
    address,
    kind: 'references',
    name: referenceName,
  })
  await queryClient.invalidateQueries({
    queryKey: neosKeys.nodes.references(address),
  })

  if (history.record === false || sameValue(before, targets)) return
  const label = editLabel(nodeType, edited, referenceName)
  const write = async (expected: string[], value: string[]) => {
    assertUnchanged(
      await currentReferenceTargets(address, referenceName),
      expected,
      label,
    )
    await persistReferenceChange(address, referenceName, value, {
      record: false,
    })
  }
  recordHistory({
    workspace: address,
    label,
    undo: () => write(targets, before),
    redo: () => write(before, targets),
    where: locatedAt(address),
  })
}

/** The targets of the node's references of the name, in their order. */
async function currentReferenceTargets(
  address: NodeAddress,
  referenceName: string,
): Promise<string[]> {
  const node = await getNode(address, { include: 'references' })
  return (node.references?.[referenceName] ?? []).map(
    (reference) => reference.nodeAggregateId,
  )
}
