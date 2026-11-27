import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DOCUMENT_NODE_TYPE, searchNodes } from '@/api/neos/endpoints/nodes'
import { isOfType, type NodeTypeMap } from '@/api/neos/endpoints/nodeTypes'
import { neosKeys } from '@/api/neos/keys'
import type { Node, NodeAddress } from '@/api/neos/schema'
import type { EffectiveAccess } from '@/api/studio/schema'
import { nodeAccessState } from '@/features/access/rules'
import { useAccess } from '@/features/access/useAccess'

/**
 * The labels of the documents from the site down to a search hit, the hit's
 * own label last - from the ancestors it was read with. Empty until the
 * node types are known.
 */
export function documentBreadcrumb(
  node: Node,
  nodeTypes: NodeTypeMap | undefined,
): string[] {
  if (nodeTypes === undefined) return []
  const documents = (node.ancestors ?? []).filter((ancestor) =>
    isOfType(nodeTypes, ancestor.nodeType, DOCUMENT_NODE_TYPE),
  )
  return [...documents.map((ancestor) => ancestor.label).reverse(), node.label]
}

/**
 * Whether the account's access roles let a search hit show: searches do not
 * apply them, so hits inside branches a role hides are left out (pages that
 * are merely restricted stay), located by the ancestors each hit is read with.
 */
export function visibleToAccount(
  node: Node,
  access: EffectiveAccess | undefined,
  siteNodeName: string,
): boolean {
  return (
    nodeAccessState(
      access,
      [
        node.nodeAggregateId,
        ...(node.ancestors ?? []).map((ancestor) => ancestor.nodeAggregateId),
      ],
      siteNodeName,
    ) !== 'hidden'
  )
}

/**
 * Search-as-you-type over the descendants of a site node: the term debounced
 * by 300 ms, searched once it has minLength characters, hits the account may
 * not see left out.
 */
export function useDocumentSearch(
  siteNode: NodeAddress | null,
  siteNodeName: string,
  term: string,
  nodeTypes: string,
  { minLength = 1, enabled = true }: { minLength?: number; enabled?: boolean },
) {
  const access = useAccess()
  const [debouncedTerm, setDebouncedTerm] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(term.trim()), 300)
    return () => clearTimeout(timer)
  }, [term])

  const active =
    enabled && siteNode !== null && debouncedTerm.length >= minLength
  const query = useQuery({
    queryKey: neosKeys.nodes.descendants(siteNode, {
      nodeTypes,
      search: debouncedTerm,
    }),
    queryFn: () => searchNodes(siteNode!, debouncedTerm, nodeTypes),
    enabled: active,
  })
  const hits = active
    ? (query.data ?? []).filter((node) =>
        visibleToAccount(node, access, siteNodeName),
      )
    : []
  return {
    hits,
    /** The term is searched for, or still waiting for its debounce. */
    loading:
      (active && query.isPending) ||
      (enabled &&
        term.trim().length >= minLength &&
        term.trim() !== debouncedTerm),
    error: query.error,
  }
}
