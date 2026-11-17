import type { Node } from '@/api/neos/schema'

/** A #fragment on a document the link dialog offers. */
export interface DocumentAnchor {
  /** What goes after the # of the node:// link. */
  readonly anchor: string
  /** The label property's value, else the node's label. */
  readonly label: string
  /** The content node carrying the anchor - unique, unlike the anchor. */
  readonly nodeAggregateId: string
}

/** The properties anchors are read from (the links.anchors setting). */
export interface AnchorProperties {
  readonly property: string
  readonly labelProperty: string
}

function filledString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * The anchors the content nodes carry, labelled by the label property when it
 * is filled and by the node's label otherwise. Nodes without a filled anchor
 * property are skipped.
 */
export function documentAnchors(
  nodes: readonly Pick<Node, 'nodeAggregateId' | 'label' | 'properties'>[],
  { property, labelProperty }: AnchorProperties,
): DocumentAnchor[] {
  return nodes.flatMap((node) => {
    const anchor = filledString(node.properties[property])
    if (anchor === null) return []
    const label =
      filledString(node.properties[labelProperty]) ??
      (node.label || node.nodeAggregateId)
    return [{ anchor, label, nodeAggregateId: node.nodeAggregateId }]
  })
}
