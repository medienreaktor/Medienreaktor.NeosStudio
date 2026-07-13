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
  /** The document shown in the preview and selected in the document tree. */
  selectedDocument: NodeDto | null
  /** The node under inspection - a document or a content node. */
  inspectedNode: NodeDto | null
  /** The last inline edit from the preview; refreshes outliner labels. */
  lastEdit: NodeEdit | null
  /** Select a document (also inspects it). */
  selectDocument: (node: NodeDto) => void
  /** Inspect a node without changing the selected document. */
  inspectNode: (node: NodeDto) => void
  /** Report that a property edit for this address was persisted. */
  nodeEdited: (address: string) => void
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
