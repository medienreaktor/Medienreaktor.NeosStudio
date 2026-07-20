import type { ItemInstance, TreeInstance } from '@headless-tree/core'
import { cn } from '@/lib/utils'
import { LoadingState } from '@/components/ui/spinner'
import { Placeholder } from '@/components/ui/placeholder'
import type { TreeRowDecor } from './nodeDecor'

/**
 * The drag-and-drop feature's additions to the tree/item instances, absent
 * from the core types the generic TreeList is written against. Present only
 * when a tree registers `dragAndDropFeature`; guarded before use.
 */
type DndTree = { getDragLineStyle: () => React.CSSProperties }
type DndItem = { isUnorderedDragTarget: () => boolean }

/**
 * Shared presentational renderer for headless-tree instances: flat item list
 * with indentation, expand arrows, selection/focus states, and optional row
 * decorations (type icon, state markers, dimming).
 */
export function TreeList<T>({
  tree,
  label,
  emptyText,
  emptyIcon,
  loading = false,
  loadingText,
  decorate,
  onItemContextMenu,
  rootless = false,
}: {
  tree: TreeInstance<T>
  /** Accessible tree label (aria-label on the container). */
  label: string
  /** Message shown, centered, when the tree has no items and isn't loading. */
  emptyText: string
  /** Optional FontAwesome icon (e.g. "fa-folder-open") for the empty state. */
  emptyIcon?: string
  /**
   * While true, an empty tree shows a centered spinner instead of the empty
   * placeholder - for trees whose root children are still loading in.
   */
  loading?: boolean
  /** Label beneath the spinner while loading. */
  loadingText?: string
  /** Row decorations for an item's data; return null for undecorated rows. */
  decorate?: (data: T) => TreeRowDecor | null
  /** Right-click on a row; when set, the browser menu is suppressed. */
  onItemContextMenu?: (item: ItemInstance<T>, event: React.MouseEvent) => void
  /**
   * For forests (many top-level items) rather than a single visible root:
   * level-0 rows keep their expand arrow and indent from level 0, instead of
   * the root special-casing the document tree/outliner rely on.
   */
  rootless?: boolean
}) {
  const items = tree.getItems()
  const isEmpty = items.length === 0
  // Present only when the tree registered the drag-and-drop feature.
  const dnd = 'getDragLineStyle' in tree ? (tree as unknown as DndTree) : null

  return (
    <div
      {...tree.getContainerProps(label)}
      className={cn(
        'flex flex-col outline-none select-none',
        // Fill the container so the empty/loading block centers vertically.
        isEmpty && 'min-h-0 flex-1',
      )}
    >
      {isEmpty &&
        (loading ? (
          <LoadingState label={loadingText} />
        ) : (
          <Placeholder icon={emptyIcon} title={emptyText} />
        ))}
      {dnd && (
        // Reorder indicator between rows; getDragLineStyle hides it (display:
        // none) when the current drop target is "into" a folder instead.
        <div
          className="pointer-events-none z-10 h-0.5 rounded-full bg-blue-500"
          style={dnd.getDragLineStyle()}
        />
      )}
      {items.map((item) => {
        const decor = decorate?.(item.getItemData()) ?? null
        // The tree's visible root (the site or the outlined document) isn't
        // collapsible - it has no sibling to collapse to, so no arrow, and
        // its row starts flush left instead of leaving room for one. Its
        // level costs no indentation, so the rest of the tree shifts left
        // by one level too, rather than sitting an extra step in from it.
        const level = item.getItemMeta().level
        const isRoot = !rootless && level === 0
        const indentLevel = rootless ? level : Math.max(level - 1, 0)
        // Highlight a folder being dropped directly onto ("make child"); the
        // between-rows case is shown by the drag line instead.
        const isDropTarget =
          'isUnorderedDragTarget' in item &&
          (item as unknown as DndItem).isUnorderedDragTarget()
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
                tree.getDataRef<{
                  selectUpToAnchorId?: string
                }>().current.selectUpToAnchorId = item.getId()
              }
              item.setFocused()
              item.primaryAction()
            }}
            onContextMenu={
              onItemContextMenu &&
              ((e) => {
                e.preventDefault()
                onItemContextMenu(item, e)
              })
            }
            className={cn(
              'flex w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-sm border border-transparent py-0.5 pr-1.5 text-left text-sm hover:bg-neutral-800',
              item.isSelected() && 'border-blue-500 bg-neutral-800',
              item.isFocused() && 'outline-0',
              isDropTarget && 'border-blue-500 bg-blue-500/10',
            )}
            style={{ paddingLeft: `${indentLevel * 14 + 2}px` }}
          >
            {!isRoot && (
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-sm text-xs text-neutral-400',
                  item.isFolder() && 'hover:bg-neutral-800 hover:text-white',
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
                {item.isFolder() ? (
                  item.isExpanded() ? (
                    <i
                      className={'fas fa-caret-down fa-fw text-[0.75rem]'}
                      aria-hidden
                    />
                  ) : (
                    <i
                      className={'fas fa-caret-right fa-fw text-[0.75rem]'}
                      aria-hidden
                    />
                  )
                ) : (
                  ''
                )}
              </span>
            )}
            {decor?.icon && (
              <span className="shrink-0 text-white">{decor.icon}</span>
            )}
            <span
              className={cn(
                'overflow-hidden text-ellipsis',
                decor?.dimmed && 'opacity-50',
              )}
            >
              {item.isLoading() ? '…' : item.getItemName()}
            </span>
            {decor?.markers && (
              <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 text-neutral-400">
                {decor.markers}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
