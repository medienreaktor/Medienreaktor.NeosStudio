import * as React from 'react'
import type { NodeDto } from '@/api/nodes'
import type { Site } from '@/api/sites'
import type { NodeEdit } from '@/features/tree/ContentOutliner'

/**
 * App state and actions exposed to panels. Panels (built-in and third-party
 * alike) render without props and read everything from this context, so a
 * panel component is self-contained and registerable. Keep this surface
 * deliberate - it is the beginning of the plugin API.
 */
export type StudioContextValue = {
  /** The active site, or null while sites load. */
  site: Site | null
  /** The active workspace's name, or null while workspaces load. */
  workspaceName: string | null
  /**
   * The own personal workspace's name, or null while workspaces load. The
   * active workspace is either this one or a shared workspace being edited
   * collaboratively.
   */
  personalWorkspaceName: string | null
  /** The document shown in the preview and selected in the document tree. */
  selectedDocument: NodeDto | null
  /** The node under inspection - a document or a content node. */
  inspectedNode: NodeDto | null
  /** The last inline edit from the preview; refreshes outliner labels. */
  lastEdit: NodeEdit | null
  /** Bumped to reload the preview iframe after edits made outside of it. */
  previewReloadToken: number
  /**
   * The last edit that wants just its nodes' elements refreshed in the
   * preview (out-of-band render + DOM swap instead of an iframe reload).
   * Usually one address; remote collaborators' edits can batch several. The
   * token distinguishes successive updates of the same addresses.
   */
  previewElementUpdate: { addresses: string[]; token: number } | null
  /** Select a document (also inspects it). */
  selectDocument: (node: NodeDto) => void
  /** Inspect a node without changing the selected document. */
  inspectNode: (node: NodeDto) => void
  /** Fetch and inspect the node at this address (e.g. a preview click). */
  inspectAddress: (address: string) => void
  /**
   * Follow a link to another document (a preview navigation): show the target
   * document, switching the active dimension to match it when they differ.
   */
  navigateToNode: (address: string) => void
  /**
   * Show a document that lives in another workspace: moves the editing
   * context to that workspace first (personal, or a writable shared one),
   * then navigates to the address - which is already bound to it. A no-op
   * context switch when the workspace is already active.
   */
  navigateToNodeInWorkspace: (address: string, workspaceName: string) => void
  /**
   * Checkout a workspace: move the editing context into it - back to the
   * personal one, or into a writable shared one (collaborative editing).
   * Client-side only (no CR command); the selected document follows into the
   * target workspace's subgraph. A no-op when already checked out.
   */
  checkoutWorkspace: (workspaceName: string) => void
  /**
   * Report inline edits made inside the preview: bumps outliner labels without
   * the refetch/reload the inspector path needs (the iframe already rendered
   * the change live).
   */
  reportInlineEdit: (addresses: string[]) => void
  /**
   * Report that a property edit for this address was persisted. reload
   * mirrors the property's configuration and defaults to 'page' (full iframe
   * reload); 'element' re-renders just the node's element out-of-band
   * (ui.reloadIfChanged); 'none' leaves the preview alone - the change does
   * not affect the rendered page. Trees and the inspector always refresh.
   */
  nodeEdited: (
    address: string,
    options?: { reload?: 'page' | 'element' | 'none' },
  ) => void
  /**
   * Report a structural change (e.g. a drag-and-drop move) affecting several
   * addresses at once - their child lists are refreshed in the trees and the
   * preview reloads, without the single-address inspector refetch nodeEdited
   * does.
   */
  nodesEdited: (addresses: string[]) => void
  /**
   * Report that the workspace's content changed wholesale (published -
   * which rebases the workspace - or discarded): every cached node read,
   * tree item and the preview are refreshed.
   */
  workspaceContentChanged: () => void
}

const StudioContext = React.createContext<StudioContextValue | null>(null)

export const StudioProvider = StudioContext.Provider

export function useStudio(): StudioContextValue {
  const value = React.useContext(StudioContext)
  if (!value) throw new Error('useStudio() requires a <StudioProvider> above')
  return value
}
