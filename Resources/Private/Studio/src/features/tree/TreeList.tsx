import type { TreeInstance } from '@headless-tree/core'
import { cn } from '@/lib/utils'

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
    <div {...tree.getContainerProps(label)} className="flex flex-col outline-none">
      {items.length === 0 && <div className="text-xs text-muted-foreground">{emptyText}</div>}
      {items.map((item) => (
        <button
          {...item.getProps()}
          key={item.getId()}
          className={cn(
            'flex w-full items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-sm border border-transparent px-1.5 py-1 text-left text-sm hover:bg-secondary',
            item.isSelected() && 'border-primary bg-secondary',
            item.isFocused() && 'outline-1 outline-dotted outline-muted-foreground',
          )}
          style={{ paddingLeft: `${item.getItemMeta().level * 14 + 6}px` }}
        >
          <span className="w-3 shrink-0 text-[0.7rem] text-muted-foreground">
            {item.isFolder() ? (item.isExpanded() ? '▾' : '▸') : ''}
          </span>
          <span className="overflow-hidden text-ellipsis">{item.isLoading() ? '…' : item.getItemName()}</span>
        </button>
      ))}
    </div>
  )
}
