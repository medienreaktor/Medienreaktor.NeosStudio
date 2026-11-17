/**
 * Rewrites the tables in TipTap's HTML into the markup CKEditor 5 stores.
 *
 * TipTap renders a table as
 *   <table style="min-width: 50px"><colgroup><col style="min-width: 25px">…
 *   </colgroup><tbody><tr><th>…</th></tr><tr><td>…</td></tr></tbody></table>
 * while Neos' classic UI (CKEditor 5) stores
 *   <figure class="table"><table><thead><tr><th>…</th></tr></thead>
 *   <tbody><tr><td>…</td></tr></tbody></table></figure>
 * and the sites' CSS is written for the latter: without the figure the table
 * shrinks to its content, and a heading row inside <tbody> is styled like a
 * body row. So on the way out every table drops TipTap's sizing (the inline
 * style, the colgroup, the cells' colwidth), moves its leading all-<th> rows
 * into a <thead> and is wrapped in <figure class="table">. Header cells in
 * later rows (a header column) stay where they are, as in CKEditor.
 *
 * Reading needs no inverse: ProseMirror's parser descends into elements it
 * has no rule for (<figure>, <thead>), so a stored CKEditor table loads as the
 * same rows and serializes back to identical markup.
 */

/** Table attributes that only carry TipTap's column sizing. */
const TABLE_SIZING_ATTRIBUTES = ['style', 'width'] as const

/** The cell attribute TipTap stores a resized column width in. */
const CELL_SIZING_ATTRIBUTE = 'colwidth'

/** Converts every table below `root` in place, nested tables included. */
export function toClassicTables(root: ParentNode): void {
  for (const table of root.querySelectorAll('table')) {
    removeSizing(table)
    moveHeadingRowsToHead(table)
    wrapInFigure(table)
  }
}

function childrenNamed(parent: Element, localName: string): Element[] {
  return [...parent.children].filter((child) => child.localName === localName)
}

function removeSizing(table: HTMLTableElement): void {
  for (const name of TABLE_SIZING_ATTRIBUTES) table.removeAttribute(name)
  for (const colgroup of childrenNamed(table, 'colgroup')) colgroup.remove()
  for (const section of table.children) {
    for (const row of section.children) {
      for (const cell of row.children) {
        cell.removeAttribute(CELL_SIZING_ATTRIBUTE)
      }
    }
  }
}

/**
 * CKEditor's heading rows are the leading rows made of header cells only; it
 * stores them in <thead> and omits <tbody> when no body row is left.
 */
function moveHeadingRowsToHead(table: HTMLTableElement): void {
  if (childrenNamed(table, 'thead').length > 0) return
  const [body] = childrenNamed(table, 'tbody')
  if (!body) return
  const rows = childrenNamed(body, 'tr')
  const firstBodyRow = rows.findIndex((row) => !isHeadingRow(row))
  const headingRows = firstBodyRow === -1 ? rows : rows.slice(0, firstBodyRow)
  if (headingRows.length === 0) return
  const head = table.ownerDocument.createElement('thead')
  head.append(...headingRows)
  body.before(head)
  if (body.children.length === 0) body.remove()
}

function isHeadingRow(row: Element): boolean {
  const cells = [...row.children]
  return cells.length > 0 && cells.every((cell) => cell.localName === 'th')
}

function wrapInFigure(table: HTMLTableElement): void {
  const parent = table.parentElement
  if (parent?.localName === 'figure' && parent.classList.contains('table')) {
    return
  }
  const figure = table.ownerDocument.createElement('figure')
  figure.className = 'table'
  table.before(figure)
  figure.append(table)
}
