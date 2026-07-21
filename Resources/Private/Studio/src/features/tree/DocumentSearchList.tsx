import { useEffect } from 'react'
import {
  DOCUMENT_NODE_TYPE,
  nodeLabel,
  useFilteredDescendants,
  type NodeDto,
} from '@/api/nodes'
import { useNodeTypes } from '@/api/nodeTypes'
import type { Site } from '@/api/sites'
import { LoadingState } from '@/components/ui/spinner'
import { Placeholder } from '@/components/ui/placeholder'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { nodeDecor } from './nodeDecor'
import { usePendingChanges } from './usePendingChanges'

/**
 * The document toolbar's search/filter result view: a flat, depth-independent
 * server-side listing of every document under the site whose title contains
 * the term and whose type is in the filter. Replaces the tree while a search
 * or filter is active; rows carry the tree's decor (type icon, hidden
 * dimming, dirty markers) plus a breadcrumb line for context.
 */
export function DocumentSearchList({
  site,
  workspaceName,
  term,
  nodeTypeFilter,
  selectedAddress = null,
  onSelect,
}: {
  site: Site
  workspaceName: string
  /** Debounced title search term; empty means "list everything matching the filter". */
  term: string
  /** Selected document node type names; empty means all documents. */
  nodeTypeFilter: string[]
  selectedAddress?: string | null
  onSelect?: (node: NodeDto) => void
}) {
  const { data: nodeTypes } = useNodeTypes()
  const pendingChanges = usePendingChanges(workspaceName)
  const results = useFilteredDescendants(
    site.nodeAddress,
    term,
    nodeTypeFilter.length > 0 ? nodeTypeFilter.join(',') : DOCUMENT_NODE_TYPE,
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
  if (site.nodeAddress !== null && results.isPending) {
    return (
      <LoadingState
        label={t('tree.searchingDocuments', 'Searching documents…')}
      />
    )
  }
  const nodes = results.data ?? []
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
        const decor = nodeDecor(node, nodeTypes, pendingChanges)
        return (
          <button
            key={node.address}
            type="button"
            role="listitem"
            onClick={() => onSelect?.(node)}
            className={cn(
              'flex w-full items-start gap-1.5 overflow-hidden rounded-sm border border-transparent px-1.5 py-1 text-left text-sm hover:bg-neutral-800',
              node.address === selectedAddress &&
                'border-blue-500 bg-neutral-800',
            )}
          >
            {decor.icon && (
              <span className="mt-0.5 shrink-0 text-white">{decor.icon}</span>
            )}
            <span className="min-w-0 flex-1">
              <span
                className={cn('block truncate', decor.dimmed && 'opacity-50')}
              >
                {nodeLabel(node)}
              </span>
              {node.breadcrumb.length > 0 && (
                <span className="block truncate text-xs text-neutral-400">
                  {node.breadcrumb.join(' › ')}
                </span>
              )}
            </span>
            {decor.markers && (
              <span className="ml-auto flex shrink-0 items-center gap-1 self-center pl-2 text-neutral-400">
                {decor.markers}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
