import { useEffect, useRef } from 'react'
import {
  nodeAddressKey,
  sameDimensionSpacePoint,
  type Node,
  type Site,
} from '@/api/neos/schema'
import { emitStudioEvent } from '@/app/events'
import { useLatestRef } from '@/hooks/use-latest-ref'

/**
 * Announces the changes of the editing context and the selection
 * (workspace.switched, site.switched, dimension.switched, document.selected,
 * node.inspected) - derived from the shell's state rather than from the
 * handlers that change it, since several paths lead to each (the switcher,
 * a followed link, a deep link, restoring the selection after a reload) and
 * the state is where they all meet.
 *
 * Compared by identity of what they name, not by object: a re-read of the
 * same node or site (every save refetches the inspected node) is no change.
 * Nothing is announced while a value is still unresolved at startup; the
 * first resolution is announced, with no previous value.
 */
export function useStudioStateEvents(state: {
  site: Site | null
  workspaceName: string | null
  dimensionSpacePoint: string | null
  selectedDocument: Node | null
  inspectedNode: Node | null
}): void {
  const { site, workspaceName, dimensionSpacePoint } = state
  // The effects below run on a change of identity (the keys); the objects
  // announced are read from here, as of the same commit.
  const latest = useLatestRef(state)
  // What was announced last. Workspace, site and dimension keep their last
  // value while unresolved (null) in between - a switch is announced from
  // the one before; the selection announces null as well.
  const previous = useRef<{
    site: Site | null
    workspaceName: string | null
    dimensionSpacePoint: string | null
    documentKey: string | null
    inspectedKey: string | null
  }>({
    site: null,
    workspaceName: null,
    dimensionSpacePoint: null,
    documentKey: null,
    inspectedKey: null,
  })

  const siteKey = site ? `${site.contentRepositoryId}\0${site.nodeName}` : null
  useEffect(() => {
    const current = latest.current.site
    if (siteKey === null || current === null) return
    const before = previous.current.site
    previous.current.site = current
    if (
      before !== null &&
      before.contentRepositoryId === current.contentRepositoryId &&
      before.nodeName === current.nodeName
    )
      return
    emitStudioEvent('site.switched', { site: current, previousSite: before })
  }, [siteKey, latest])

  useEffect(() => {
    const before = previous.current.workspaceName
    if (workspaceName === null || workspaceName === before) return
    previous.current.workspaceName = workspaceName
    emitStudioEvent('workspace.switched', {
      workspaceName,
      previousWorkspaceName: before,
    })
  }, [workspaceName])

  useEffect(() => {
    const before = previous.current.dimensionSpacePoint
    if (
      dimensionSpacePoint === null ||
      (before !== null && sameDimensionSpacePoint(before, dimensionSpacePoint))
    )
      return
    previous.current.dimensionSpacePoint = dimensionSpacePoint
    emitStudioEvent('dimension.switched', {
      dimensionSpacePoint,
      previousDimensionSpacePoint: before,
    })
  }, [dimensionSpacePoint])

  const { selectedDocument, inspectedNode } = state
  const documentKey = selectedDocument ? nodeAddressKey(selectedDocument) : null
  useEffect(() => {
    if (documentKey === previous.current.documentKey) return
    previous.current.documentKey = documentKey
    emitStudioEvent('document.selected', {
      node: latest.current.selectedDocument,
    })
  }, [documentKey, latest])

  const inspectedKey = inspectedNode ? nodeAddressKey(inspectedNode) : null
  useEffect(() => {
    if (inspectedKey === previous.current.inspectedKey) return
    previous.current.inspectedKey = inspectedKey
    emitStudioEvent('node.inspected', { node: latest.current.inspectedNode })
  }, [inspectedKey, latest])
}
