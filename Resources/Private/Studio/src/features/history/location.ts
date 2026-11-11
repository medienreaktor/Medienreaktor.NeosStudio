import {
  DOCUMENT_NODE_TYPE,
  fetchAncestors,
  fetchNode,
} from '@/api/neos/endpoints/nodes'
import {
  fetchNodeTypes,
  isOfType,
  nodeTypeMap,
} from '@/api/neos/endpoints/nodeTypes'
import { type NodeAddress, nodeAddressOf } from '@/api/neos/schema'
import { historyChanged } from './historyStore'

/**
 * Where an edit is seen: the document showing it, and the node to select in
 * it - what the shell navigates to after an undo/redo, so its result is in
 * view even when it was made on another page.
 */
export interface HistoryLocation {
  /** The document the edited node is (or is in). */
  document: NodeAddress
  documentLabel: string
  /** The content node to select in the document; null: the document itself. */
  node: NodeAddress | null
  /**
   * Shown when the document no longer exists after the undo/redo (an undone
   * page creation, a redone page deletion): the document above it.
   */
  fallback: NodeAddress | null
}

/** A location resolved in the background - null until (or unless) it is. */
export interface Located {
  current: HistoryLocation | null
}

/**
 * The location of the node as it is now - read while it exists (before a
 * deletion, after a creation). Mostly from cached reads: the node and its
 * ancestors are usually loaded already, the node types always are. Null if
 * the node can't be read.
 */
export async function locate(
  address: NodeAddress,
): Promise<HistoryLocation | null> {
  try {
    const [node, documents, nodeTypes] = await Promise.all([
      fetchNode(address),
      fetchAncestors(address, DOCUMENT_NODE_TYPE),
      fetchNodeTypes(address.contentRepositoryId),
    ])
    // Nearest first: the document the node is in, or the one above a document.
    const [closest] = documents
    if (isOfType(nodeTypeMap(nodeTypes), node.nodeType, DOCUMENT_NODE_TYPE)) {
      return {
        document: address,
        documentLabel: node.label,
        node: null,
        fallback: closest ? nodeAddressOf(closest) : null,
      }
    }
    if (!closest) return null
    return {
      document: nodeAddressOf(closest),
      documentLabel: closest.label,
      node: address,
      fallback: null,
    }
  } catch {
    return null
  }
}

/**
 * The location of a node placed below the parent (a move's target): the
 * parent's document - the parent itself if it is one.
 */
export async function locateBelow(
  address: NodeAddress,
  parent: NodeAddress,
): Promise<HistoryLocation | null> {
  const [own, parentLocation] = await Promise.all([
    locate(address),
    locate(parent),
  ])
  if (!parentLocation) return null
  // A moved document is shown itself, with the parent's page to fall back to.
  if (own?.node === null) {
    return { ...own, fallback: parentLocation.document }
  }
  return {
    document: parentLocation.document,
    documentLabel: parentLocation.documentLabel,
    node: address,
    fallback: null,
  }
}

/**
 * Holds what the promise resolves to once it does, telling the history so
 * the buttons' titles can name the page.
 */
export function located(
  location: Promise<HistoryLocation | null> | HistoryLocation | null,
): Located {
  const holder: Located = { current: null }
  void Promise.resolve(location).then((resolved) => {
    holder.current = resolved
    historyChanged()
  })
  return holder
}

/** For edits seen in the same place whether undone or redone. */
export function locatedAt(address: NodeAddress): {
  undo: Located
  redo: Located
} {
  const at = located(locate(address))
  return { undo: at, redo: at }
}
