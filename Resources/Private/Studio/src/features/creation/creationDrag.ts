/**
 * A tiny bus connecting the node creation panel to the preview pane: the
 * panel announces drag start/end of a node type, the preview forwards it to
 * the guest script (which cannot read the HTML5 dataTransfer payload during
 * dragover - only on drop - so the dragged type travels out of band).
 */

export type CreationDrag = { nodeTypeName: string } | null

let current: CreationDrag = null
const listeners = new Set<(drag: CreationDrag) => void>()

export function startCreationDrag(nodeTypeName: string): void {
  current = { nodeTypeName }
  listeners.forEach((listener) => listener(current))
}

export function endCreationDrag(): void {
  if (current === null) return
  current = null
  listeners.forEach((listener) => listener(null))
}

export function getCreationDrag(): CreationDrag {
  return current
}

export function subscribeCreationDrag(
  listener: (drag: CreationDrag) => void,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
