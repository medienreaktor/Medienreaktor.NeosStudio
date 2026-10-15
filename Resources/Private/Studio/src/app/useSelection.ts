import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { isNotFound } from '@/api/http/errors'
import { fetchNode, useNode } from '@/api/neos/endpoints/nodes'
import {
  isRemoved,
  nodeAddressOf,
  type Node,
  type NodeAddress,
} from '@/api/neos/schema'
import { reportNothingToPreview } from '@/app/boot'
import { clearDeepLink, deepLinkReveal, deepLinkTarget } from '@/app/deepLink'
import { flashNode } from '@/app/flash'
import { readStored, writeStored } from '@/app/storage'

// Remembers the selected document across reloads. Only the aggregate id is
// stored - the full address is bound to a workspace and dimension, so on reload
// the id is re-resolved against the current site's subgraph instead.
const SELECTED_DOCUMENT_KEY = 'neos-studio.selected_document'

/**
 * One selected node, by address. The node itself is read through the query
 * cache, so every invalidation of it (an edit, a publish, a collaborator's
 * change) reaches the selection without anyone refetching by hand.
 */
type Selected = {
  address: NodeAddress
  /**
   * Read it including removed nodes: a deleted page opened from the trash
   * (and the content inside it) does not exist for a normal read.
   */
  removed: boolean
  /**
   * The node as the selecting code had it, shown until the selection's own
   * read is in the cache - a node picked in a tree comes from a differently
   * keyed read (a node type filter), and the shell should not blank for the
   * round trip. Never shown once the read has answered.
   */
  placeholder: Node | null
}

type SelectionState = {
  /** The document shown in the preview and selected in the document tree. */
  document: Selected | null
  /** The node under inspection - a document or a content node. */
  inspected: Selected | null
}

const NOTHING: SelectionState = { document: null, inspected: null }

function selectedOf(node: Node): Selected {
  return {
    address: nodeAddressOf(node),
    removed: isRemoved(node),
    placeholder: node,
  }
}

/**
 * The selected node as currently read. A node that is gone (404 - deleted,
 * or published away from the trash) reads as null; any other failure keeps
 * the last answer, since a hiccup is no reason to drop the selection.
 */
function useSelectedNode(selected: Selected | null): Node | null {
  const { data, error } = useNode(
    selected?.address ?? null,
    true,
    selected?.removed ?? false,
  )
  if (selected === null || isNotFound(error)) return null
  return data ?? selected.placeholder
}

export type Selection = {
  documentAddress: NodeAddress | null
  /** The selected document, null while none is (or it is gone). */
  document: Node | null
  /** The node under inspection, null while none is (or it is gone). */
  inspected: Node | null
  /** Select a document (also inspects it). */
  selectDocument: (node: Node) => void
  /** Inspect a node without changing the selected document. */
  inspectNode: (node: Node) => void
  /**
   * Read and inspect the node at this address (e.g. a preview click); keeps
   * the current inspection if the read fails.
   */
  inspectAddress: (address: NodeAddress) => void
  /**
   * Read the document at this address and select it once it resolves -
   * after `beforeSelect`, which may adjust the editing context to it. Stays on
   * the current document if the read fails.
   */
  navigateTo: (
    address: NodeAddress,
    beforeSelect?: (node: Node) => void,
  ) => void
  /**
   * Keep the selected document across a dimension or editing-context switch:
   * its address in the target subgraph (it may not exist there - then
   * nothing is selected). The inspection returns to the document.
   */
  follow: (
    subgraph: Partial<
      Pick<NodeAddress, 'workspaceName' | 'dimensionSpacePoint'>
    >,
  ) => void
  /**
   * Drop the selection - and, for `forget`, the remembered document, which
   * belongs to the previous site after a site switch.
   */
  clear: (options?: { forget?: boolean }) => void
}

/**
 * The selected document and the inspected node. Both are held as addresses
 * and read through the node queries, never as copies of a node: an
 * invalidation updates them wherever they are shown.
 *
 * Asynchronous selections (a read that has to succeed first) are tagged with
 * a generation, and any later selection change supersedes them - the last
 * click wins, not the last response.
 *
 * `siteAddress` is the active site's node in the editing context, null until
 * that context has resolved; the first one restores the selection.
 */
export function useSelection(siteAddress: NodeAddress | null): Selection {
  const [state, setState] = useState<SelectionState>(NOTHING)
  const generation = useRef(0)
  const select = (
    next: SelectionState | ((previous: SelectionState) => SelectionState),
  ) => {
    generation.current++
    setState(next)
  }
  /** Run `apply` with the result of `read` - unless superseded meanwhile. */
  const whenCurrent = (
    read: Promise<Node>,
    apply: (node: Node) => void,
    fail: () => void = () => {},
  ) => {
    const request = ++generation.current
    read.then(
      (node) => {
        if (generation.current === request) apply(node)
      },
      () => {
        if (generation.current === request) fail()
      },
    )
  }

  const document = useSelectedNode(state.document)
  const inspected = useSelectedNode(state.inspected)

  // Remember the selected document so a reload lands on it again. Persist just
  // the aggregate id; the address itself is workspace/dimension-bound.
  const documentAggregateId = state.document?.address.nodeAggregateId ?? null
  useEffect(() => {
    if (documentAggregateId !== null) {
      writeStored(SELECTED_DOCUMENT_KEY, documentAggregateId)
    }
  }, [documentAggregateId])

  // Restore the remembered document once the editing context is known (the
  // site node's address carries the current workspace and dimension). A
  // stored id that no longer resolves, and the no-stored-id case, both fall
  // back to the site's root document node. Runs once per load - dimension and
  // site switches drive their own reselection and must not be overridden
  // here, and any selection the user makes meanwhile wins over it.
  const didRestore = useRef(false)
  // An effect event: it reads the current address, deep link and callbacks,
  // while only a changed address value (below) triggers it.
  const restoreSelection = useEffectEvent(() => {
    if (didRestore.current || !siteAddress) return
    didRestore.current = true
    const selectBoth = (node: Node) =>
      select({ document: selectedOf(node), inspected: selectedOf(node) })
    const selectRoot = () =>
      whenCurrent(fetchNode(siteAddress), selectBoth, () => {
        // Fine - the tree simply starts unselected. Nothing will reach the
        // preview, so the boot screen has nothing to wait for either.
        reportNothingToPreview()
      })
    // A deep link wins over the remembered selection - it is an explicit
    // request from outside the shell. Only its aggregate id and dimension are
    // used: the site address supplies the content repository and, crucially,
    // the workspace the editor is actually working in. A link built elsewhere
    // names the live workspace, and dropping the editor into live would show
    // them a document they cannot edit.
    if (deepLinkTarget) {
      clearDeepLink()
      const documentAddress: NodeAddress = {
        ...siteAddress,
        nodeAggregateId: deepLinkTarget.nodeAggregateId,
        dimensionSpacePoint: deepLinkTarget.dimensionSpacePoint,
      }
      // Bound locally: the narrowing below has to survive into the nested callbacks.
      const revealId = deepLinkReveal
      whenCurrent(
        fetchNode(documentAddress),
        (deepLinked) => {
          // The document has to be the selected one either way - the preview
          // renders it, and the content node only exists inside it.
          selectBoth(deepLinked)
          if (revealId === null) return
          // Selecting the content node is all it takes to reveal it: the
          // preview pane mirrors the shell's selection into the guest, which
          // scrolls it into view and outlines it. flashNode adds the brief
          // pulse on top, so the editor sees *which* element was meant even
          // when the outline alone is easy to miss. The node may have been
          // deleted or moved since the link was made; landing on the page is
          // still the useful half of the answer.
          whenCurrent(
            fetchNode({ ...documentAddress, nodeAggregateId: revealId }),
            (contentNode) => {
              select((previous) => ({
                ...previous,
                inspected: selectedOf(contentNode),
              }))
              flashNode(revealId)
            },
          )
        },
        // The document may live in another site, or not exist in that
        // dimension at all - fall back rather than showing an empty shell.
        selectRoot,
      )
      return
    }
    const storedId = readStored(SELECTED_DOCUMENT_KEY)
    if (!storedId) {
      selectRoot()
      return
    }
    whenCurrent(
      fetchNode({ ...siteAddress, nodeAggregateId: storedId }),
      selectBoth,
      selectRoot,
    )
  })
  useEffect(() => {
    restoreSelection()
    // Keyed by value: the address is a new object on every render.
  }, [siteAddress?.nodeAggregateId, siteAddress?.workspaceName])

  return {
    documentAddress: state.document?.address ?? null,
    document,
    inspected,
    selectDocument: (node) =>
      select({ document: selectedOf(node), inspected: selectedOf(node) }),
    inspectNode: (node) =>
      select((previous) => ({ ...previous, inspected: selectedOf(node) })),
    inspectAddress: (address) => {
      // Content inside a deleted page carries its "removed" tag too - read it
      // the way the page is read.
      const removed = state.document?.removed ?? false
      whenCurrent(fetchNode(address, undefined, removed), (node) =>
        select((previous) => ({ ...previous, inspected: selectedOf(node) })),
      )
    },
    navigateTo: (address, beforeSelect) =>
      whenCurrent(fetchNode(address), (node) => {
        beforeSelect?.(node)
        select({ document: selectedOf(node), inspected: selectedOf(node) })
      }),
    follow: (subgraph) =>
      select((previous) => {
        if (previous.document === null) return NOTHING
        const followed: Selected = {
          address: { ...previous.document.address, ...subgraph },
          removed: previous.document.removed,
          placeholder: null,
        }
        return { document: followed, inspected: followed }
      }),
    clear: (options) => {
      select(NOTHING)
      if (options?.forget) writeStored(SELECTED_DOCUMENT_KEY, null)
    },
  }
}
