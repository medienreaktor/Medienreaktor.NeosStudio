import { neosKeys } from '@/api/neos/keys'
import type { Node, NodeAddress } from '@/api/neos/schema'
import { queryClient } from '@/app/queryClient'
import { translate as t, translatePlural as tp } from '@/lib/i18n'

/**
 * The node's label from any cached read of it (the editor has usually seen
 * what it edits: selected, in a tree, inspected), null if there is none.
 */
export function cachedNodeLabel(address: NodeAddress): string | null {
  for (const [, data] of queryClient.getQueriesData<unknown>({
    queryKey: neosKeys.nodes.node(address),
  })) {
    const node = data as Partial<Node> | undefined
    if (
      node &&
      typeof node.label === 'string' &&
      node.nodeAggregateId === address.nodeAggregateId
    ) {
      return node.label
    }
  }
  return null
}

/**
 * What a history label names the edited nodes by: one node by its label
 * (quoted), several by their number. Snapshot the labels when recording -
 * the nodes may be gone when the label is shown.
 */
export function nodesSubject(labels: (string | null)[]): () => string {
  const [only] = labels
  return () =>
    labels.length === 1 && only
      ? t('undo.quoted', '“{0}”', [only])
      : tp('undo.elements', labels.length, ['{0} element', '{0} elements'])
}
