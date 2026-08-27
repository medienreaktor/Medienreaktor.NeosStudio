import type { ItemInstance, TreeInstance } from '@headless-tree/core'
import { cn } from '@/lib/utils'
import { Placeholder } from '@/components/ui/placeholder'
import { Skeleton } from '@/components/ui/skeleton'
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
   * While true, an empty tree shows skeleton rows instead of the empty
   * placeholder - for trees whose root children are still loading in.
   */
  loading?: boolean
  /** Screen-reader announcement while the skeleton rows show. */
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
          <TreeListSkeleton label={loadingText} />
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
                // File-manager semantics: right-clicking a row outside the
                // current selection makes it the selection (and the shift
                // anchor), right-clicking inside it keeps the selection - so
                // the menu always acts on the highlighted rows.
                if (!item.isSelected()) {
                  tree.setSelectedItems([item.getId()])
                  tree.getDataRef<{
                    selectUpToAnchorId?: string
                  }>().current.selectUpToAnchorId = item.getId()
                }
                onItemContextMenu(item, e)
              })
            }
            className={cn(
              'flex w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-sm border border-transparent py-0.5 pr-1.5 text-left text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 motion-safe:animate-tree-row-in',
              item.isSelected() &&
                'border-blue-500 bg-neutral-100 dark:bg-neutral-800',
              item.isFocused() && 'outline-0',
              isDropTarget && 'border-blue-500 bg-blue-500/10',
            )}
            style={{ paddingLeft: `${indentLevel * 14 + 2}px` }}
          >
            {!isRoot && (
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-sm text-xs text-neutral-600 dark:text-neutral-400',
                  item.isFolder() &&
                    'hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-950 dark:hover:text-white',
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
                  <i
                    className={cn(
                      'fas fa-caret-right fa-fw text-[0.75rem] transition-transform duration-150',
                      item.isExpanded() && 'rotate-90',
                    )}
                    aria-hidden
                  />
                ) : (
                  ''
                )}
              </span>
            )}
            {decor?.icon && (
              <span className="shrink-0 text-neutral-950 dark:text-white">
                {decor.icon}
              </span>
            )}
            {/* Not isLoading(): that also covers children-loading, which
                would swap an expanding folder's own label out for a skeleton
                and blink it back in once the children arrive. */}
            {!item.hasLoadedData() ? (
              <Skeleton
                className="h-3 max-w-full"
                style={{ width: `${skeletonWidth(item.getId())}px` }}
              />
            ) : (
              <span
                className={cn(
                  'overflow-hidden text-ellipsis motion-safe:animate-fade-in',
                  decor?.dimmed && 'opacity-50',
                )}
                style={{ color: decor?.color, opacity: decor?.opacity }}
              >
                {item.getItemName()}
              </span>
            )}
            {decor?.markers && (
              <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 text-neutral-600 dark:text-neutral-400">
                {decor.markers}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Label width for a row whose data is still loading, derived from the item id
 * so it stays put across re-renders instead of jumping around.
 */
function skeletonWidth(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return 64 + (Math.abs(hash) % 72)
}

/**
 * Placeholder while a tree's root children load: a plausible mini-hierarchy
 * of skeleton rows, fading out toward the bottom. Row geometry (indent step,
 * icon size, spacing) mirrors the real rows so the loaded tree replaces it
 * without a layout jump.
 */
const SKELETON_ROWS = [
  { level: 0, width: 96 },
  { level: 1, width: 128 },
  { level: 2, width: 88 },
  { level: 2, width: 112 },
  { level: 1, width: 72 },
  { level: 1, width: 104 },
]

function TreeListSkeleton({ label }: { label?: string }) {
  return (
    <div role="status" className="motion-safe:animate-fade-in">
      {label && <span className="sr-only">{label}</span>}
      {SKELETON_ROWS.map((row, index) => (
        <div
          key={index}
          className="flex h-6 items-center gap-1.5"
          style={{
            paddingLeft: `${row.level * 14 + 4}px`,
            opacity: 1 - index * 0.13,
          }}
        >
          <Skeleton className="size-4 shrink-0" />
          <Skeleton className="h-3" style={{ width: `${row.width}px` }} />
        </div>
      ))}
    </div>
  )
}
