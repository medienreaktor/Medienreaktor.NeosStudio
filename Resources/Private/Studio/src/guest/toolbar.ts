/**
 * The inline-editing toolbars: two floating bars that read live editor state
 * inside the preview iframe, split by what the user is doing.
 *
 * - The inline toolbar is a bubble above the text selection, shown while a
 *   range is selected; it carries the inline marks (bold, italic, link, ...).
 * - The block toolbar sits at the top-left of the block the caret is in, shown
 *   while the selection is collapsed; it carries block-level actions (block
 *   type, headings, lists, alignment, ...).
 *
 * Items come from one registry (registerToolbarItem) tagged with a `kind`; the
 * two toolbars each render the items of their kind. Availability is gated on
 * the property's NodeType formatting config (see formatting.ts), so a property
 * only offers the actions it permits - the extensible richtextToolbar seam.
 *
 * Buttons act on mousedown with preventDefault so focus never leaves the
 * editor - otherwise clicking a button would blur the editor, collapse the
 * selection and hide the toolbar before the command ran.
 */
import type { Editor } from '@tiptap/core'
import { CellSelection } from '@tiptap/pm/tables'
import { editorFormatting } from './formatting'
import { requestLinkEdit } from './linkEditing'

export type ToolbarKind = 'inline' | 'block'

export interface ToolbarItem {
  /** Stable id, also used to dedupe registrations. */
  id: string
  /** Which toolbar the item belongs to. */
  kind: ToolbarKind
  /** Visual group; a separator is drawn between adjacent groups. */
  group: string
  /** Accessible label / tooltip. */
  label: string
  /** Inline SVG markup, or plain text, for the button face. */
  icon: string
  /** Whether the mark/node is currently active at the selection. */
  isActive(editor: Editor): boolean
  /** Apply the command to the editor. */
  run(editor: Editor): void
  /** Whether the item applies to this editor (default: always). */
  isAvailable?(editor: Editor): boolean
}

const ACTIVE_CLASS = 'neos-studio-toolbar-active'
const TOOLBAR_CLASS = 'neos-studio-toolbar'
const ACCENT = 'rgb(0, 173, 238)'

const items: ToolbarItem[] = []

/** Contribute a toolbar item; a later registration with the same id wins. */
export function registerToolbarItem(item: ToolbarItem): void {
  const index = items.findIndex((existing) => existing.id === item.id)
  if (index === -1) items.push(item)
  else items[index] = item
}

let stylesInjected = false

function injectStyles(): void {
  if (stylesInjected) return
  stylesInjected = true
  const style = document.createElement('style')
  style.textContent = `
    .${TOOLBAR_CLASS} {
      position: fixed;
      z-index: 2147483647;
      display: none;
      align-items: center;
      gap: 2px;
      padding: 4px;
      background: #1a1a1a;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
      user-select: none;
      -webkit-user-select: none;
    }
    .${TOOLBAR_CLASS} button {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 28px;
      height: 28px;
      padding: 0 6px;
      margin: 0;
      border: none;
      border-radius: 5px;
      background: transparent;
      color: #e6e6e6;
      cursor: pointer;
      font-family: system-ui, sans-serif;
      font-size: 13px;
      font-weight: 600;
      line-height: 1;
    }
    .${TOOLBAR_CLASS} button:hover {
      background: rgba(255, 255, 255, 0.12);
    }
    .${TOOLBAR_CLASS} button.${ACTIVE_CLASS} {
      background: ${ACCENT};
      color: #fff;
    }
    .${TOOLBAR_CLASS} button svg {
      width: 16px;
      height: 16px;
    }
    .${TOOLBAR_CLASS} .neos-studio-toolbar-sep {
      width: 1px;
      align-self: stretch;
      margin: 3px 2px;
      background: rgba(255, 255, 255, 0.15);
    }
  `
  document.head.appendChild(style)
}

/** Positions a visible toolbar element relative to the editor's selection. */
type Positioner = (element: HTMLElement, editor: Editor) => void

/**
 * One floating bar, rendering the registry items of a single kind. It rebuilds
 * its buttons whenever the active editor changes (the property's config
 * decides which items are available), then just toggles active state on
 * selection changes.
 */
class Toolbar {
  private element: HTMLElement | null = null
  private buttons = new Map<string, HTMLButtonElement>()
  private currentEditor: Editor | null = null
  /** The available-item set the buttons were last built for. */
  private renderedSignature: string | null = null

  constructor(
    private readonly kind: ToolbarKind,
    private readonly positioner: Positioner,
  ) {}

  private itemsForKind(): ToolbarItem[] {
    return items.filter((item) => item.kind === this.kind)
  }

  /**
   * The ids of the items available for `editor`, in order. Availability can
   * change within one editor as the caret moves (e.g. table ops appear only
   * inside a table), so the buttons rebuild whenever this set changes - not
   * just when the editor changes.
   */
  private availabilitySignature(editor: Editor): string {
    return this.itemsForKind()
      .filter((item) => !item.isAvailable || item.isAvailable(editor))
      .map((item) => item.id)
      .join(',')
  }

  private ensureElement(): HTMLElement {
    if (this.element) return this.element
    injectStyles()
    const element = document.createElement('div')
    element.className = TOOLBAR_CLASS
    element.setAttribute('role', 'toolbar')
    document.body.appendChild(element)
    this.element = element
    return element
  }

  private renderButtons(editor: Editor): void {
    const element = this.ensureElement()
    element.replaceChildren()
    this.buttons = new Map()
    let previousGroup: string | null = null
    for (const item of this.itemsForKind()) {
      if (item.isAvailable && !item.isAvailable(editor)) continue
      if (previousGroup !== null && item.group !== previousGroup) {
        const separator = document.createElement('div')
        separator.className = 'neos-studio-toolbar-sep'
        element.appendChild(separator)
      }
      previousGroup = item.group
      const button = document.createElement('button')
      button.type = 'button'
      button.title = item.label
      button.setAttribute('aria-label', item.label)
      button.innerHTML = item.icon
      button.addEventListener('mousedown', (event) => {
        // Keep the editor focused and the selection intact.
        event.preventDefault()
        if (this.currentEditor) {
          item.run(this.currentEditor)
          this.refreshActiveStates()
          this.reposition()
        }
      })
      this.buttons.set(item.id, button)
      element.appendChild(button)
    }
    this.renderedSignature = this.availabilitySignature(editor)
  }

  private refreshActiveStates(): void {
    if (!this.currentEditor) return
    for (const [id, button] of this.buttons) {
      const item = items.find((candidate) => candidate.id === id)
      if (item)
        button.classList.toggle(ACTIVE_CLASS, item.isActive(this.currentEditor))
    }
  }

  show(editor: Editor): void {
    const element = this.ensureElement()
    this.currentEditor = editor
    if (this.renderedSignature !== this.availabilitySignature(editor))
      this.renderButtons(editor)
    if (this.buttons.size === 0) {
      this.hide()
      return
    }
    element.style.display = 'flex'
    this.refreshActiveStates()
    this.positioner(element, editor)
  }

  hide(): void {
    this.currentEditor = null
    if (this.element) this.element.style.display = 'none'
  }

  reposition(): void {
    if (this.element?.style.display === 'flex' && this.currentEditor)
      this.positioner(this.element, this.currentEditor)
  }
}

/** Float the inline bubble centered above the selection, flip below if needed. */
function positionInline(element: HTMLElement): void {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  const width = element.offsetWidth
  const height = element.offsetHeight
  let left = rect.left + rect.width / 2 - width / 2
  left = Math.max(4, Math.min(left, window.innerWidth - width - 4))
  let top = rect.top - height - 8
  if (top < 4) top = rect.bottom + 8
  element.style.left = `${left}px`
  element.style.top = `${top}px`
}

/** The viewport rect of the top-level block the caret sits in. */
function currentBlockRect(editor: Editor): DOMRect | null {
  const { $from } = editor.state.selection
  if ($from.depth === 0) return null
  const dom = editor.view.nodeDOM($from.before(1))
  return dom instanceof HTMLElement ? dom.getBoundingClientRect() : null
}

/** Anchor the block bar just above the top-left corner of the current block. */
function positionBlock(element: HTMLElement, editor: Editor): void {
  const rect = currentBlockRect(editor)
  if (!rect) {
    element.style.display = 'none'
    return
  }
  const width = element.offsetWidth
  const height = element.offsetHeight
  let left = Math.max(4, Math.min(rect.left, window.innerWidth - width - 4))
  let top = rect.top - height - 4
  if (top < 4) top = rect.top + 4
  element.style.left = `${left}px`
  element.style.top = `${top}px`
}

const inlineToolbar = new Toolbar('inline', positionInline)
const blockToolbar = new Toolbar('block', positionBlock)

/**
 * Reflect the current selection: the inline bubble over a text range, the
 * block bar at the caret's block, nothing when the two coincide.
 */
export function updateToolbars(editor: Editor): void {
  const { selection } = editor.state
  // A cell selection (dragging across table cells) is non-empty but is not a
  // text range - it drives the table ops (merge, ...), so route it to the
  // block toolbar alongside the collapsed-caret case, not the inline bubble.
  if (selection.empty || selection instanceof CellSelection) {
    inlineToolbar.hide()
    blockToolbar.show(editor)
  } else {
    blockToolbar.hide()
    inlineToolbar.show(editor)
  }
}

export function hideToolbars(): void {
  inlineToolbar.hide()
  blockToolbar.hide()
}

function repositionToolbars(): void {
  inlineToolbar.reposition()
  blockToolbar.reposition()
}

// Keep both bars pinned as the selection moves (capture catches nested
// scroll containers).
window.addEventListener('scroll', repositionToolbars, true)
window.addEventListener('resize', repositionToolbars)

const svg = (paths: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

// --- Block-level items (block toolbar) -------------------------------------

// Block type: paragraph and the enabled heading levels.
registerToolbarItem({
  id: 'paragraph',
  kind: 'block',
  group: 'block',
  label: 'Paragraph',
  icon: 'P',
  isAvailable: (editor) => editorFormatting(editor).paragraph,
  isActive: (editor) => editor.isActive('paragraph'),
  run: (editor) => editor.chain().focus().setParagraph().run(),
})
for (const level of [1, 2, 3, 4, 5, 6] as const) {
  registerToolbarItem({
    id: `heading-${level}`,
    kind: 'block',
    group: 'block',
    label: `Heading ${level}`,
    icon: `H${level}`,
    isAvailable: (editor) =>
      editorFormatting(editor).headingLevels.includes(level),
    isActive: (editor) => editor.isActive('heading', { level }),
    run: (editor) => editor.chain().focus().toggleHeading({ level }).run(),
  })
}

// Lists and indentation.
registerToolbarItem({
  id: 'bulletList',
  kind: 'block',
  group: 'list',
  label: 'Bullet list',
  icon: svg(
    '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  ),
  isAvailable: (editor) => editorFormatting(editor).bulletList,
  isActive: (editor) => editor.isActive('bulletList'),
  run: (editor) => editor.chain().focus().toggleBulletList().run(),
})
registerToolbarItem({
  id: 'orderedList',
  kind: 'block',
  group: 'list',
  label: 'Ordered list',
  icon: svg(
    '<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  ),
  isAvailable: (editor) => editorFormatting(editor).orderedList,
  isActive: (editor) => editor.isActive('orderedList'),
  run: (editor) => editor.chain().focus().toggleOrderedList().run(),
})
registerToolbarItem({
  id: 'sink',
  kind: 'block',
  group: 'list',
  label: 'Indent',
  icon: svg(
    '<polyline points="3 8 7 12 3 16"/><line x1="11" y1="6" x2="21" y2="6"/><line x1="11" y1="12" x2="21" y2="12"/><line x1="11" y1="18" x2="21" y2="18"/>',
  ),
  isAvailable: (editor) =>
    editorFormatting(editor).bulletList || editorFormatting(editor).orderedList,
  isActive: () => false,
  run: (editor) => editor.chain().focus().sinkListItem('listItem').run(),
})
registerToolbarItem({
  id: 'lift',
  kind: 'block',
  group: 'list',
  label: 'Outdent',
  icon: svg(
    '<polyline points="7 8 3 12 7 16"/><line x1="11" y1="6" x2="21" y2="6"/><line x1="11" y1="12" x2="21" y2="12"/><line x1="11" y1="18" x2="21" y2="18"/>',
  ),
  isAvailable: (editor) =>
    editorFormatting(editor).bulletList || editorFormatting(editor).orderedList,
  isActive: () => false,
  run: (editor) => editor.chain().focus().liftListItem('listItem').run(),
})

// Block quote and code block.
registerToolbarItem({
  id: 'blockquote',
  kind: 'block',
  group: 'quote',
  label: 'Blockquote',
  icon: svg(
    '<path d="M6 17h3l2-4V7H5v6h3z"/><path d="M14 17h3l2-4V7h-6v6h3z"/>',
  ),
  isAvailable: (editor) => editorFormatting(editor).blockquote,
  isActive: (editor) => editor.isActive('blockquote'),
  run: (editor) => editor.chain().focus().toggleBlockquote().run(),
})
registerToolbarItem({
  id: 'codeBlock',
  kind: 'block',
  group: 'quote',
  label: 'Code block',
  icon: svg(
    '<rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="9 10 7 12 9 14"/><polyline points="15 10 17 12 15 14"/>',
  ),
  isAvailable: (editor) => editorFormatting(editor).codeBlock,
  isActive: (editor) => editor.isActive('codeBlock'),
  run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
})

// Text alignment.
const alignments = [
  {
    id: 'left',
    label: 'Align left',
    lines: ['3 6 21 6', '3 12 15 12', '3 18 21 18'],
  },
  {
    id: 'center',
    label: 'Align center',
    lines: ['3 6 21 6', '6 12 18 12', '3 18 21 18'],
  },
  {
    id: 'right',
    label: 'Align right',
    lines: ['3 6 21 6', '9 12 21 12', '3 18 21 18'],
  },
  {
    id: 'justify',
    label: 'Justify',
    lines: ['3 6 21 6', '3 12 21 12', '3 18 21 18'],
  },
] as const
for (const align of alignments) {
  registerToolbarItem({
    id: `align-${align.id}`,
    kind: 'block',
    group: 'align',
    label: align.label,
    icon: svg(
      align.lines
        .map((points) => {
          const [x1, y1, x2, y2] = points.split(' ')
          return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`
        })
        .join(''),
    ),
    isAvailable: (editor) => editorFormatting(editor).alignment,
    isActive: (editor) => editor.isActive({ textAlign: align.id }),
    run: (editor) => editor.chain().focus().setTextAlign(align.id).run(),
  })
}

// Horizontal rule.
registerToolbarItem({
  id: 'horizontalRule',
  kind: 'block',
  group: 'insert',
  label: 'Horizontal rule',
  icon: svg('<line x1="3" y1="12" x2="21" y2="12"/>'),
  isAvailable: (editor) => editorFormatting(editor).horizontalRule,
  isActive: () => false,
  run: (editor) => editor.chain().focus().setHorizontalRule().run(),
})

// Tables. Insert is offered outside a table; the row/column/merge/header
// operations only inside one. Column resizing is built in (drag the cell
// borders); cell/table properties and captions are follow-ups.
registerToolbarItem({
  id: 'insertTable',
  kind: 'block',
  group: 'table',
  label: 'Insert table',
  icon: svg(
    '<rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>',
  ),
  isAvailable: (editor) =>
    editorFormatting(editor).table && !editor.isActive('table'),
  isActive: () => false,
  run: (editor) =>
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run(),
})
const inTable = (editor: Editor): boolean =>
  editorFormatting(editor).table && editor.isActive('table')
registerToolbarItem({
  id: 'addColumnBefore',
  kind: 'block',
  group: 'table',
  label: 'Add column before',
  icon: svg(
    '<rect x="9" y="4" width="12" height="16" rx="1"/><line x1="15" y1="4" x2="15" y2="20"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="4" y1="10" x2="4" y2="14"/>',
  ),
  isAvailable: inTable,
  isActive: () => false,
  run: (editor) => editor.chain().focus().addColumnBefore().run(),
})
registerToolbarItem({
  id: 'addColumnAfter',
  kind: 'block',
  group: 'table',
  label: 'Add column after',
  icon: svg(
    '<rect x="3" y="4" width="12" height="16" rx="1"/><line x1="9" y1="4" x2="9" y2="20"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="20" y1="10" x2="20" y2="14"/>',
  ),
  isAvailable: inTable,
  isActive: () => false,
  run: (editor) => editor.chain().focus().addColumnAfter().run(),
})
registerToolbarItem({
  id: 'deleteColumn',
  kind: 'block',
  group: 'table',
  label: 'Delete column',
  icon: svg(
    '<rect x="3" y="4" width="18" height="16" rx="1"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="15" y1="9" x2="21" y2="15"/><line x1="21" y1="9" x2="15" y2="15"/>',
  ),
  isAvailable: inTable,
  isActive: () => false,
  run: (editor) => editor.chain().focus().deleteColumn().run(),
})
registerToolbarItem({
  id: 'addRowBefore',
  kind: 'block',
  group: 'table',
  label: 'Add row before',
  icon: svg(
    '<rect x="4" y="9" width="16" height="11" rx="1"/><line x1="4" y1="14" x2="20" y2="14"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="10" y1="4" x2="14" y2="4"/>',
  ),
  isAvailable: inTable,
  isActive: () => false,
  run: (editor) => editor.chain().focus().addRowBefore().run(),
})
registerToolbarItem({
  id: 'addRowAfter',
  kind: 'block',
  group: 'table',
  label: 'Add row after',
  icon: svg(
    '<rect x="4" y="4" width="16" height="11" rx="1"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="10" y1="20" x2="14" y2="20"/>',
  ),
  isAvailable: inTable,
  isActive: () => false,
  run: (editor) => editor.chain().focus().addRowAfter().run(),
})
registerToolbarItem({
  id: 'deleteRow',
  kind: 'block',
  group: 'table',
  label: 'Delete row',
  icon: svg(
    '<rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="9" y1="15" x2="15" y2="21"/><line x1="15" y1="15" x2="9" y2="21"/>',
  ),
  isAvailable: inTable,
  isActive: () => false,
  run: (editor) => editor.chain().focus().deleteRow().run(),
})
registerToolbarItem({
  id: 'mergeOrSplit',
  kind: 'block',
  group: 'table',
  label: 'Merge or split cells',
  icon: svg(
    '<rect x="3" y="4" width="18" height="16" rx="1"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="12" y1="4" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="20"/>',
  ),
  isAvailable: inTable,
  isActive: () => false,
  run: (editor) => editor.chain().focus().mergeOrSplit().run(),
})
registerToolbarItem({
  id: 'toggleHeaderRow',
  kind: 'block',
  group: 'table',
  label: 'Toggle header row',
  icon: svg(
    '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18" fill="none"/><rect x="3" y="4" width="18" height="5" fill="currentColor" stroke="none"/>',
  ),
  isAvailable: inTable,
  isActive: (editor) => editor.isActive('tableHeader'),
  run: (editor) => editor.chain().focus().toggleHeaderRow().run(),
})
registerToolbarItem({
  id: 'deleteTable',
  kind: 'block',
  group: 'table',
  label: 'Delete table',
  icon: svg(
    '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  ),
  isAvailable: inTable,
  isActive: () => false,
  run: (editor) => editor.chain().focus().deleteTable().run(),
})

// --- Inline items (inline toolbar) -----------------------------------------

registerToolbarItem({
  id: 'bold',
  kind: 'inline',
  group: 'mark',
  label: 'Bold',
  icon: svg(
    '<path d="M6 4h8a4 4 0 0 1 0 8H6z"/><path d="M6 12h9a4 4 0 0 1 0 8H6z"/>',
  ),
  isAvailable: (editor) => editorFormatting(editor).bold,
  isActive: (editor) => editor.isActive('bold'),
  run: (editor) => editor.chain().focus().toggleBold().run(),
})
registerToolbarItem({
  id: 'italic',
  kind: 'inline',
  group: 'mark',
  label: 'Italic',
  icon: svg(
    '<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>',
  ),
  isAvailable: (editor) => editorFormatting(editor).italic,
  isActive: (editor) => editor.isActive('italic'),
  run: (editor) => editor.chain().focus().toggleItalic().run(),
})
registerToolbarItem({
  id: 'underline',
  kind: 'inline',
  group: 'mark',
  label: 'Underline',
  icon: svg(
    '<path d="M6 3v7a6 6 0 0 0 12 0V3"/><line x1="4" y1="21" x2="20" y2="21"/>',
  ),
  isAvailable: (editor) => editorFormatting(editor).underline,
  isActive: (editor) => editor.isActive('underline'),
  run: (editor) => editor.chain().focus().toggleUnderline().run(),
})
registerToolbarItem({
  id: 'strike',
  kind: 'inline',
  group: 'mark',
  label: 'Strikethrough',
  icon: svg(
    '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/>',
  ),
  isAvailable: (editor) => editorFormatting(editor).strike,
  isActive: (editor) => editor.isActive('strike'),
  run: (editor) => editor.chain().focus().toggleStrike().run(),
})
registerToolbarItem({
  id: 'subscript',
  kind: 'inline',
  group: 'mark',
  label: 'Subscript',
  icon: svg(
    '<path d="M4 5l8 10"/><path d="M12 5l-8 10"/><path d="M20 19h-4c0-1.5 3-2 3-3.5a1.5 1.5 0 0 0-3-.5"/>',
  ),
  isAvailable: (editor) => editorFormatting(editor).subscript,
  isActive: (editor) => editor.isActive('subscript'),
  run: (editor) => editor.chain().focus().toggleSubscript().run(),
})
registerToolbarItem({
  id: 'superscript',
  kind: 'inline',
  group: 'mark',
  label: 'Superscript',
  icon: svg(
    '<path d="M4 9l8 10"/><path d="M12 9l-8 10"/><path d="M20 9h-4c0-1.5 3-2 3-3.5a1.5 1.5 0 0 0-3-.5"/>',
  ),
  isAvailable: (editor) => editorFormatting(editor).superscript,
  isActive: (editor) => editor.isActive('superscript'),
  run: (editor) => editor.chain().focus().toggleSuperscript().run(),
})
registerToolbarItem({
  id: 'code',
  kind: 'inline',
  group: 'mark',
  label: 'Inline code',
  icon: svg(
    '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  ),
  isAvailable: (editor) => editorFormatting(editor).code,
  isActive: (editor) => editor.isActive('code'),
  run: (editor) => editor.chain().focus().toggleCode().run(),
})
// Link. The dialog lives in the host shell (it needs the document tree and
// the Media Library) - the guest hands off and applies the answer; see
// linkEditing.ts.
const LINK_ICON = svg(
  '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
)
registerToolbarItem({
  id: 'link',
  kind: 'inline',
  group: 'link',
  label: 'Link',
  icon: LINK_ICON,
  isAvailable: (editor) => editorFormatting(editor).link,
  isActive: (editor) => editor.isActive('link'),
  run: (editor) => requestLinkEdit(editor),
})
// A collapsed caret inside a link shows the block toolbar (the inline bubble
// needs a range) - offer editing the link there too, so a click into an
// existing link can edit it without reselecting it.
registerToolbarItem({
  id: 'link-edit',
  kind: 'block',
  group: 'link',
  label: 'Edit link',
  icon: LINK_ICON,
  isAvailable: (editor) =>
    editorFormatting(editor).link && editor.isActive('link'),
  isActive: (editor) => editor.isActive('link'),
  run: (editor) => requestLinkEdit(editor),
})
registerToolbarItem({
  id: 'removeFormat',
  kind: 'inline',
  group: 'clear',
  label: 'Clear formatting',
  icon: svg(
    '<path d="M6 4h12v3"/><path d="M9 20h6"/><path d="M13 7l-3 13"/><line x1="4" y1="4" x2="20" y2="20"/>',
  ),
  isAvailable: (editor) => editorFormatting(editor).removeFormat,
  isActive: () => false,
  run: (editor) => editor.chain().focus().unsetAllMarks().run(),
})
