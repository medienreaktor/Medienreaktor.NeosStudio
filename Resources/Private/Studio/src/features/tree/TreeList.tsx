import type { TreeInstance } from '@headless-tree/core'
import { cn } from '@/lib/utils'
import type { TreeRowDecor } from './nodeDecor'

/**
 * Shared presentational renderer for headless-tree instances: flat item list
 * with indentation, expand arrows, selection/focus states, and optional row
 * decorations (type icon, state markers, dimming).
 */
export function TreeList<T>({
  tree,
  label,
  emptyText,
  decorate,
}: {
  tree: TreeInstance<T>
  /** Accessible tree label (aria-label on the container). */
  label: string
  emptyText: string
  /** Row decorations for an item's data; return null for undecorated rows. */
  decorate?: (data: T) => TreeRowDecor | null
}) {
  const items = tree.getItems()

  return (
    <div {...tree.getContainerProps(label)} className="flex flex-col outline-none">
      {items.length === 0 && <div className="text-xs text-muted-foreground">{emptyText}</div>}
      {items.map((item) => {
        const decor = decorate?.(item.getItemData()) ?? null
        return (
          <button
            {...item.getProps()}
            key={item.getId()}
            // Replaces the composed headless-tree onClick (selection + focus +
            // primary action + expand toggle) with the same behavior MINUS the
            // toggle: clicking a row must never expand/collapse - only the
            // chevron does that.
            onClick={(e) => {
              if (e.shiftKey) {
                item.selectUpTo(e.ctrlKey || e.metaKey)
              } else if (e.ctrlKey || e.metaKey) {
                item.toggleSelect()
              } else {
                tree.setSelectedItems([item.getId()])
              }
              if (!e.shiftKey) {
                // Internal anchor bookkeeping the selection feature does on
                // click; kept so shift-range selection anchors correctly.
                tree.getDataRef<{ selectUpToAnchorId?: string }>().current.selectUpToAnchorId = item.getId()
              }
              item.setFocused()
              item.primaryAction()
            }}
            className={cn(
              'flex w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-sm border border-transparent py-0.5 pr-1.5 text-left text-sm hover:bg-secondary',
              item.isSelected() && 'border-primary bg-secondary',
              item.isFocused() && 'outline-1 outline-dotted outline-muted-foreground',
            )}
            style={{ paddingLeft: `${item.getItemMeta().level * 14 + 2}px` }}
          >
            <span
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-sm text-xs text-muted-foreground',
                item.isFolder() && 'hover:bg-accent hover:text-foreground',
              )}
              onClick={(e) => {
                e.stopPropagation()
                if (!item.isFolder()) return
                if (item.isExpanded()) {
                  item.collapse()
                } else {
                  item.expand()
                }
              }}
            >
              {item.isFolder() ? (item.isExpanded() ? '▾' : '▸') : ''}
            </span>
            {decor?.icon && (
              <span className={cn('shrink-0 text-muted-foreground', decor.dimmed && 'opacity-50')}>
                {decor.icon}
              </span>
            )}
            <span className={cn('overflow-hidden text-ellipsis', decor?.dimmed && 'opacity-50')}>
              {item.isLoading() ? '…' : item.getItemName()}
            </span>
            {decor?.markers && (
              <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 text-muted-foreground">
                {decor.markers}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
