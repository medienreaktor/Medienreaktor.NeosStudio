/**
 * A copy of `list` with the item at `from` moved to `to` - the reorder step of
 * the drag-sortable inspector editors. Out-of-range indexes leave the order
 * as it is (a stale drag index must not insert `undefined`).
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  if (from < 0 || from >= next.length) return next
  const [moved] = next.splice(from, 1) as [T]
  next.splice(to, 0, moved)
  return next
}
