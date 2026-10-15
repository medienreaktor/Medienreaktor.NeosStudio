import { useEffect, useMemo } from 'react'
import {
  DOCUMENT_NODE_TYPE,
  useFilteredDescendants,
} from '@/api/neos/endpoints/nodes'
import {
  isOfType,
  type NodeTypeMap,
  useNodeTypes,
} from '@/api/neos/endpoints/nodeTypes'
import { siteNodeAddress } from '@/api/neos/endpoints/sites'
import {
  type Node,
  type NodeAddress,
  nodeAddressKey,
  sameNodeAddress,
  type Site,
} from '@/api/neos/schema'
import { nodeAccessState } from '@/features/access/rules'
import { useAccess } from '@/features/access/useAccess'
import { LoadingState } from '@/components/ui/spinner'
import { Placeholder } from '@/components/ui/placeholder'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useNodeDecorators } from './decorators'
import { nodeDecor } from './nodeDecor'
import { usePendingChanges } from './usePendingChanges'

/**
 * The labels of the documents from the site down to the node, the node's own
 * last - from the ancestors a search hit is read with.
 */
function breadcrumbOf(node: Node, nodeTypes: NodeTypeMap | undefined) {
  if (nodeTypes === undefined) return []
  return [
    ...(node.ancestors ?? [])
      .filter((ancestor) =>
        isOfType(nodeTypes, ancestor.nodeType, DOCUMENT_NODE_TYPE),
      )
      .map((ancestor) => ancestor.label)
      .reverse(),
    node.label,
  ]
}

/**
 * The document toolbar's search/filter result view: a flat, depth-independent
 * server-side listing of every document under the site whose title contains
 * the term and whose type is in the filter. Replaces the tree while a search
 * or filter is active; rows carry the tree's decor (type icon, hidden
 * dimming, dirty markers) plus a breadcrumb line for context. Documents the
 * account's access roles hide are left out, as in the tree.
 */
export function DocumentSearchList({
  site,
  workspaceName,
  dimensionSpacePoint,
  term,
  nodeTypeFilter,
  selectedAddress = null,
  onSelect,
}: {
  site: Site
  workspaceName: string
  /** The dimension space point searched in (JSON). */
  dimensionSpacePoint: string
  /** Debounced title search term; empty means "list everything matching the filter". */
  term: string
  /** Selected document node type names; empty means all documents. */
  nodeTypeFilter: string[]
  selectedAddress?: NodeAddress | null
  onSelect?: (node: Node) => void
}) {
  const { data: nodeTypes } = useNodeTypes()
  const decorators = useNodeDecorators()
  const pendingChanges = usePendingChanges(workspaceName)
  const access = useAccess()
  const siteNode = siteNodeAddress(site, workspaceName, dimensionSpacePoint)
  const results = useFilteredDescendants(
    siteNode,
    term,
    nodeTypeFilter.length > 0 ? nodeTypeFilter.join(',') : DOCUMENT_NODE_TYPE,
  )
  // Hits inside branches an access role refuses outright stay out, like in
  // the tree - located by the ancestors each hit is read with.
  const nodes = useMemo(
    () =>
      (results.data ?? []).filter(
        (node) =>
          nodeAccessState(
            access,
            [
              node.nodeAggregateId,
              ...(node.ancestors ?? []).map(
                (ancestor) => ancestor.nodeAggregateId,
              ),
            ],
            site.nodeName,
          ) !== 'hidden',
      ),
    [results.data, access, site.nodeName],
  )
  useEffect(() => {
    if (results.error) {
      toast.error(results.error, {
        title: t('tree.searchFailed', 'Searching documents failed'),
        id: 'document-search',
      })
    }
  }, [results.error])

  // A site without a node has no descendants to search (the query is disabled
  // and would pend forever).
  if (siteNode !== null && results.isPending) {
    return (
      <LoadingState
        label={t('tree.searchingDocuments', 'Searching documents…')}
      />
    )
  }
  if (nodes.length === 0) {
    return (
      <Placeholder
        icon="fa-magnifying-glass"
        title={t('tree.noSearchMatch', 'No documents match the search.')}
      />
    )
  }
  return (
    <div
      className="flex flex-col"
      role="list"
      aria-label={t('tree.searchResultsLabel', 'Document search results')}
    >
      {nodes.map((node) => {
        const decor = nodeDecor(node, nodeTypes, pendingChanges, [], decorators)
        const breadcrumb = breadcrumbOf(node, nodeTypes)
        return (
          <button
            key={nodeAddressKey(node)}
            type="button"
            role="listitem"
            onClick={() => onSelect?.(node)}
            className={cn(
              'flex w-full items-start gap-1.5 overflow-hidden rounded-sm border border-transparent px-1.5 py-1 text-left text-sm hover:bg-neutral-200 dark:hover:bg-neutral-800',
              sameNodeAddress(node, selectedAddress) &&
                'border-blue-500 bg-neutral-200 dark:bg-neutral-800',
            )}
          >
            {decor.icon && (
              <span className="mt-0.5 shrink-0 text-neutral-950 dark:text-white">
                {decor.icon}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span
                className={cn('block truncate', decor.dimmed && 'opacity-50')}
                style={{ color: decor.color, opacity: decor.opacity }}
              >
                {node.label || node.nodeAggregateId}
              </span>
              {breadcrumb.length > 0 && (
                <span className="block truncate text-xs text-neutral-600 dark:text-neutral-400">
                  {breadcrumb.join(' › ')}
                </span>
              )}
            </span>
            {decor.markers && (
              <span className="ml-auto flex shrink-0 items-center gap-1 self-center pl-2 text-neutral-600 dark:text-neutral-400">
                {decor.markers}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
