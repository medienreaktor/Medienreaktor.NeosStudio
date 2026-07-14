/**
 * The floating inline-formatting toolbar: a bubble that appears above the
 * current text selection while editing a property. It renders inside the
 * preview iframe so it reads live editor state with no cross-frame lag.
 *
 * Buttons come from a registry (registerToolbarItem) - the extensible
 * richtextToolbar seam. Each item declares whether it applies to the current
 * editor (isAvailable), gated on the property's NodeType formatting config
 * (see formatting.ts), so a property only offers the actions it permits. The
 * default items below cover the formatting todolist; plugins and later phases
 * (tables) contribute more.
 *
 * Buttons act on mousedown with preventDefault so focus never leaves the
 * editor - otherwise clicking a button would blur the editor, collapse the
 * selection and hide the toolbar before the command ran.
 */
import type { Editor } from '@tiptap/core'
import { editorFormatting } from './formatting'

export interface ToolbarItem {
  /** Stable id, also used to dedupe registrations. */
  id: string
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

const TOOLBAR_ID = 'neos-studio-richtext-toolbar'
const ACTIVE_CLASS = 'neos-studio-toolbar-active'
const ACCENT = 'rgb(0, 173, 238)'

const items: ToolbarItem[] = []

/** Contribute a toolbar item; a later registration with the same id wins. */
export function registerToolbarItem(item: ToolbarItem): void {
  const index = items.findIndex((existing) => existing.id === item.id)
  if (index === -1) items.push(item)
  else items[index] = item
}

let toolbar: HTMLElement | null = null
let buttons = new Map<string, HTMLButtonElement>()
/** The editor the visible toolbar acts on. */
let currentEditor: Editor | null = null
/** The editor the buttons were last rendered for (config drives which show). */
let renderedForEditor: Editor | null = null

function injectStyles(): void {
  const style = document.createElement('style')
  style.textContent = `
    #${TOOLBAR_ID} {
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
    #${TOOLBAR_ID} button {
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
    #${TOOLBAR_ID} button:hover {
      background: rgba(255, 255, 255, 0.12);
    }
    #${TOOLBAR_ID} button.${ACTIVE_CLASS} {
      background: ${ACCENT};
      color: #fff;
    }
    #${TOOLBAR_ID} button svg {
      width: 16px;
      height: 16px;
    }
    #${TOOLBAR_ID} .neos-studio-toolbar-sep {
      width: 1px;
      align-self: stretch;
      margin: 3px 2px;
      background: rgba(255, 255, 255, 0.15);
    }
  `
  document.head.appendChild(style)
}

function ensureToolbar(): HTMLElement {
  if (toolbar) return toolbar
  injectStyles()
  toolbar = document.createElement('div')
  toolbar.id = TOOLBAR_ID
  toolbar.setAttribute('role', 'toolbar')
  document.body.appendChild(toolbar)
  // Keep the bubble pinned to the selection as it moves (capture catches
  // nested scroll containers).
  window.addEventListener('scroll', repositionToolbar, true)
  window.addEventListener('resize', repositionToolbar)
  return toolbar
}

/** Rebuild the button row for `editor`, showing only the items it allows. */
function renderButtons(editor: Editor): void {
  const element = ensureToolbar()
  element.replaceChildren()
  buttons = new Map()
  let previousGroup: string | null = null
  for (const item of items) {
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
      if (currentEditor) {
        item.run(currentEditor)
        refreshActiveStates()
      }
    })
    buttons.set(item.id, button)
    element.appendChild(button)
  }
  renderedForEditor = editor
}

function refreshActiveStates(): void {
  if (!currentEditor) return
  for (const [id, button] of buttons) {
    const item = items.find((candidate) => candidate.id === id)
    if (item) button.classList.toggle(ACTIVE_CLASS, item.isActive(currentEditor))
  }
}

function position(): void {
  const element = ensureToolbar()
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  const width = element.offsetWidth
  const height = element.offsetHeight
  let left = rect.left + rect.width / 2 - width / 2
  left = Math.max(4, Math.min(left, window.innerWidth - width - 4))
  // Float above the selection; flip below when there is no room.
  let top = rect.top - height - 8
  if (top < 4) top = rect.bottom + 8
  element.style.left = `${left}px`
  element.style.top = `${top}px`
}

/** Show the toolbar for `editor` if its selection spans text; hide otherwise. */
export function updateToolbar(editor: Editor): void {
  const element = ensureToolbar()
  const { empty } = editor.state.selection
  const selection = window.getSelection()
  const collapsed =
    empty ||
    !selection ||
    selection.rangeCount === 0 ||
    selection.getRangeAt(0).getBoundingClientRect().width === 0
  if (collapsed) {
    hideToolbar()
    return
  }
  currentEditor = editor
  if (renderedForEditor !== editor) renderButtons(editor)
  element.style.display = 'flex'
  refreshActiveStates()
  position()
}

export function hideToolbar(): void {
  currentEditor = null
  if (toolbar) toolbar.style.display = 'none'
}

/** Reposition while visible (selection moves under scroll / resize). */
export function repositionToolbar(): void {
  if (toolbar?.style.display === 'flex') position()
}

const svg = (paths: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

// --- Default items, in visual order. Availability is gated on the property's
// --- resolved formatting config (formatting.ts).

// Block type: paragraph and the enabled heading levels.
registerToolbarItem({
  id: 'paragraph',
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
    group: 'block',
    label: `Heading ${level}`,
    icon: `H${level}`,
    isAvailable: (editor) => editorFormatting(editor).headingLevels.includes(level),
    isActive: (editor) => editor.isActive('heading', { level }),
    run: (editor) => editor.chain().focus().toggleHeading({ level }).run(),
  })
}

// Lists.
registerToolbarItem({
  id: 'bulletList',
  group: 'list',
  label: 'Bullet list',
  icon: svg('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'),
  isAvailable: (editor) => editorFormatting(editor).bulletList,
  isActive: (editor) => editor.isActive('bulletList'),
  run: (editor) => editor.chain().focus().toggleBulletList().run(),
})
registerToolbarItem({
  id: 'orderedList',
  group: 'list',
  label: 'Ordered list',
  icon: svg('<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>'),
  isAvailable: (editor) => editorFormatting(editor).orderedList,
  isActive: (editor) => editor.isActive('orderedList'),
  run: (editor) => editor.chain().focus().toggleOrderedList().run(),
})
registerToolbarItem({
  id: 'sink',
  group: 'list',
  label: 'Indent',
  icon: svg('<polyline points="3 8 7 12 3 16"/><line x1="11" y1="6" x2="21" y2="6"/><line x1="11" y1="12" x2="21" y2="12"/><line x1="11" y1="18" x2="21" y2="18"/>'),
  isAvailable: (editor) =>
    editorFormatting(editor).bulletList || editorFormatting(editor).orderedList,
  isActive: () => false,
  run: (editor) => editor.chain().focus().sinkListItem('listItem').run(),
})
registerToolbarItem({
  id: 'lift',
  group: 'list',
  label: 'Outdent',
  icon: svg('<polyline points="7 8 3 12 7 16"/><line x1="11" y1="6" x2="21" y2="6"/><line x1="11" y1="12" x2="21" y2="12"/><line x1="11" y1="18" x2="21" y2="18"/>'),
  isAvailable: (editor) =>
    editorFormatting(editor).bulletList || editorFormatting(editor).orderedList,
  isActive: () => false,
  run: (editor) => editor.chain().focus().liftListItem('listItem').run(),
})

// Inline marks.
registerToolbarItem({
  id: 'bold',
  group: 'mark',
  label: 'Bold',
  icon: svg('<path d="M6 4h8a4 4 0 0 1 0 8H6z"/><path d="M6 12h9a4 4 0 0 1 0 8H6z"/>'),
  isAvailable: (editor) => editorFormatting(editor).bold,
  isActive: (editor) => editor.isActive('bold'),
  run: (editor) => editor.chain().focus().toggleBold().run(),
})
registerToolbarItem({
  id: 'italic',
  group: 'mark',
  label: 'Italic',
  icon: svg('<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>'),
  isAvailable: (editor) => editorFormatting(editor).italic,
  isActive: (editor) => editor.isActive('italic'),
  run: (editor) => editor.chain().focus().toggleItalic().run(),
})
registerToolbarItem({
  id: 'underline',
  group: 'mark',
  label: 'Underline',
  icon: svg('<path d="M6 3v7a6 6 0 0 0 12 0V3"/><line x1="4" y1="21" x2="20" y2="21"/>'),
  isAvailable: (editor) => editorFormatting(editor).underline,
  isActive: (editor) => editor.isActive('underline'),
  run: (editor) => editor.chain().focus().toggleUnderline().run(),
})
registerToolbarItem({
  id: 'strike',
  group: 'mark',
  label: 'Strikethrough',
  icon: svg('<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/>'),
  isAvailable: (editor) => editorFormatting(editor).strike,
  isActive: (editor) => editor.isActive('strike'),
  run: (editor) => editor.chain().focus().toggleStrike().run(),
})
registerToolbarItem({
  id: 'subscript',
  group: 'mark',
  label: 'Subscript',
  icon: svg('<path d="M4 5l8 10"/><path d="M12 5l-8 10"/><path d="M20 19h-4c0-1.5 3-2 3-3.5a1.5 1.5 0 0 0-3-.5"/>'),
  isAvailable: (editor) => editorFormatting(editor).subscript,
  isActive: (editor) => editor.isActive('subscript'),
  run: (editor) => editor.chain().focus().toggleSubscript().run(),
})
registerToolbarItem({
  id: 'superscript',
  group: 'mark',
  label: 'Superscript',
  icon: svg('<path d="M4 9l8 10"/><path d="M12 9l-8 10"/><path d="M20 9h-4c0-1.5 3-2 3-3.5a1.5 1.5 0 0 0-3-.5"/>'),
  isAvailable: (editor) => editorFormatting(editor).superscript,
  isActive: (editor) => editor.isActive('superscript'),
  run: (editor) => editor.chain().focus().toggleSuperscript().run(),
})
registerToolbarItem({
  id: 'code',
  group: 'mark',
  label: 'Inline code',
  icon: svg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
  isAvailable: (editor) => editorFormatting(editor).code,
  isActive: (editor) => editor.isActive('code'),
  run: (editor) => editor.chain().focus().toggleCode().run(),
})

// Link. The URL is collected with a prompt for now; a proper in-bubble input
// popover is a follow-up.
registerToolbarItem({
  id: 'link',
  group: 'link',
  label: 'Link',
  icon: svg('<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>'),
  isAvailable: (editor) => editorFormatting(editor).link,
  isActive: (editor) => editor.isActive('link'),
  run: (editor) => {
    const current = (editor.getAttributes('link').href as string) ?? ''
    const url = window.prompt('Link URL', current)
    if (url === null) return
    const chain = editor.chain().focus().extendMarkRange('link')
    if (url === '') chain.unsetLink().run()
    else chain.setLink({ href: url }).run()
  },
})

// Block quote and code block.
registerToolbarItem({
  id: 'blockquote',
  group: 'block2',
  label: 'Blockquote',
  icon: svg('<path d="M6 17h3l2-4V7H5v6h3z"/><path d="M14 17h3l2-4V7h-6v6h3z"/>'),
  isAvailable: (editor) => editorFormatting(editor).blockquote,
  isActive: (editor) => editor.isActive('blockquote'),
  run: (editor) => editor.chain().focus().toggleBlockquote().run(),
})
registerToolbarItem({
  id: 'codeBlock',
  group: 'block2',
  label: 'Code block',
  icon: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="9 10 7 12 9 14"/><polyline points="15 10 17 12 15 14"/>'),
  isAvailable: (editor) => editorFormatting(editor).codeBlock,
  isActive: (editor) => editor.isActive('codeBlock'),
  run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
})

// Text alignment.
const alignments = [
  { id: 'left', label: 'Align left', lines: ['3 6 21 6', '3 12 15 12', '3 18 21 18'] },
  { id: 'center', label: 'Align center', lines: ['3 6 21 6', '6 12 18 12', '3 18 21 18'] },
  { id: 'right', label: 'Align right', lines: ['3 6 21 6', '9 12 21 12', '3 18 21 18'] },
  { id: 'justify', label: 'Justify', lines: ['3 6 21 6', '3 12 21 12', '3 18 21 18'] },
] as const
for (const align of alignments) {
  registerToolbarItem({
    id: `align-${align.id}`,
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

// Horizontal rule and clear formatting.
registerToolbarItem({
  id: 'horizontalRule',
  group: 'insert',
  label: 'Horizontal rule',
  icon: svg('<line x1="3" y1="12" x2="21" y2="12"/>'),
  isAvailable: (editor) => editorFormatting(editor).horizontalRule,
  isActive: () => false,
  run: (editor) => editor.chain().focus().setHorizontalRule().run(),
})
registerToolbarItem({
  id: 'removeFormat',
  group: 'clear',
  label: 'Clear formatting',
  icon: svg('<path d="M6 4h12v3"/><path d="M9 20h6"/><path d="M13 7l-3 13"/><line x1="4" y1="4" x2="20" y2="20"/>'),
  isAvailable: (editor) => editorFormatting(editor).removeFormat,
  isActive: () => false,
  run: (editor) => editor.chain().focus().unsetAllMarks().run(),
})
