import type { TreeInstance } from '@headless-tree/core'

/**
 * Shared presentational renderer for headless-tree instances: flat item list
 * with indentation, expand arrows, selection/focus states.
 */
export function TreeList<T>({
  tree,
  label,
  emptyText,
}: {
  tree: TreeInstance<T>
  /** Accessible tree label (aria-label on the container). */
  label: string
  emptyText: string
}) {
  const items = tree.getItems()

  return (
    <div {...tree.getContainerProps(label)} className="tree">
      {items.length === 0 && <div className="muted small">{emptyText}</div>}
      {items.map((item) => (
        <button
          {...item.getProps()}
          key={item.getId()}
          className={['tree-item', item.isSelected() ? 'selected' : '', item.isFocused() ? 'focused' : '']
            .filter(Boolean)
            .join(' ')}
          style={{ paddingLeft: `${item.getItemMeta().level * 14 + 6}px` }}
        >
          <span className="tree-arrow">{item.isFolder() ? (item.isExpanded() ? '▾' : '▸') : ''}</span>
          <span className="tree-label">{item.isLoading() ? '…' : item.getItemName()}</span>
        </button>
      ))}
    </div>
  )
}
