/**
 * The rich-text engine behind Studio inline editing: a TipTap (ProseMirror)
 * editor mounted in place on every inline-editable property the edit-mode
 * markup emits ([data-__neos-property], from Neos.Neos:Editable). It replaces
 * the plain contentEditable the guest used before, giving structured,
 * schema-constrained editing that serializes back to clean HTML.
 *
 * The engine only owns the editor lifecycle (mount, commit-on-blur,
 * Escape-revert, empty-state for the placeholder). Node identity, the
 * host bridge and the property-changed protocol stay in main.ts: mounting
 * takes a `commit(element, html)` hook that main.ts fulfils by resolving the
 * NodeAddress and posting to the host, and an `activity()` hook it uses to
 * keep the floating element handle attached while the layout shifts under an
 * edit.
 *
 * TipTap mounts by appending its own contenteditable (.tiptap) into the
 * property element, so `editor.getHTML()` returns the property value without
 * the host wrapper - exactly what Neos stores.
 */
import { Editor } from '@tiptap/core'
import {
  extensionsFor,
  parseFormatting,
  setEditorFormatting,
} from './formatting'
import { hideToolbars, updateToolbars } from './toolbar'

const PROPERTY_ATTRIBUTE = 'data-__neos-property'
const PLACEHOLDER_ATTRIBUTE = 'data-__neos-studio-placeholder'
const SHINE_THROUGH_ATTRIBUTE = 'data-__neos-studio-shine-through'
const EMPTY_CLASS = 'neos-studio-empty'

export interface RichTextHooks {
  /** An edit was committed (blur with changed content); html is getHTML(). */
  commit(element: HTMLElement, html: string): void
  /** The editor gained focus or its content changed - reposition chrome. */
  activity(): void
}

/** Toggle the empty class that drives the CSS placeholder (::before). */
function refreshEmptyState(element: HTMLElement, editor: Editor): void {
  if (!element.hasAttribute(PLACEHOLDER_ATTRIBUTE)) return
  element.classList.toggle(EMPTY_CLASS, editor.isEmpty)
}

let stylesInjected = false

/**
 * Editing affordances the rendered site does not style: the cell borders that
 * keep an in-progress table legible, the selected-cell highlight and the
 * column-resize handle ProseMirror's table view draws. Scoped to the editor
 * (.tiptap inside a property) so the site's own table styling is untouched.
 */
function injectEditorStyles(): void {
  if (stylesInjected) return
  stylesInjected = true
  const style = document.createElement('style')
  style.textContent = `
    [${PROPERTY_ATTRIBUTE}] .tiptap .tableWrapper {
      overflow-x: auto;
    }
    [${PROPERTY_ATTRIBUTE}] .tiptap table {
      border-collapse: collapse;
      table-layout: fixed;
      width: 100%;
      margin: 0;
    }
    [${PROPERTY_ATTRIBUTE}] .tiptap :is(td, th) {
      position: relative;
      min-width: 2em;
      border: 1px solid rgba(0, 0, 0, 0.25);
      padding: 4px 6px;
      vertical-align: top;
    }
    [${PROPERTY_ATTRIBUTE}] .tiptap th {
      font-weight: 600;
      background: rgba(0, 0, 0, 0.04);
    }
    [${PROPERTY_ATTRIBUTE}] .tiptap .selectedCell::after {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(0, 173, 238, 0.15);
      pointer-events: none;
    }
    [${PROPERTY_ATTRIBUTE}] .tiptap .column-resize-handle {
      position: absolute;
      right: -2px;
      top: 0;
      bottom: -2px;
      width: 4px;
      background: rgb(0, 173, 238);
      pointer-events: none;
    }
    [${PROPERTY_ATTRIBUTE}] .tiptap.resize-cursor {
      cursor: col-resize;
    }
  `
  document.head.appendChild(style)
}

const editorsByElement = new Map<HTMLElement, Editor>()

function mountEditor(element: HTMLElement, hooks: RichTextHooks): void {
  if (editorsByElement.has(element)) return
  // TipTap appends its own editable into the element without removing the
  // host-rendered markup, so we snapshot that markup as the initial content
  // and clear the element first - otherwise the original and the editor's
  // render coexist and the content visibly doubles.
  const initialContent = element.innerHTML
  element.replaceChildren()
  // The schema and toolbar are constrained to what the property's NodeType
  // declares (data-__neos-studio-formatting); a property without config gets
  // a permissive default.
  const config = parseFormatting(element)
  // The committed baseline, captured after TipTap normalizes the markup so a
  // blur without a real edit never reports a spurious change. setContent on
  // Escape restores exactly this string, so the ensuing blur is a no-op.
  let committedHtml = ''
  const editor = new Editor({
    element,
    content: initialContent,
    extensions: extensionsFor(config),
    editorProps: {
      // Neos node drags (from the element handle or the creation panel) must
      // never drop into a rich-text editor. Returning true (without
      // preventDefault) keeps the editor from becoming a drop target, so the
      // drag resolves against the enclosing content collection (main.ts's
      // drop machinery) instead. This also disables ProseMirror's own
      // internal drag-drop, which the Studio does not use.
      handleDOMEvents: {
        dragover: () => true,
        drop: () => true,
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Escape') {
          editor.commands.setContent(committedHtml)
          editor.commands.blur()
          return true
        }
        return false
      },
    },
    onCreate: ({ editor }) => {
      committedHtml = editor.getHTML()
      refreshEmptyState(element, editor)
    },
    onFocus: ({ editor }) => {
      updateToolbars(editor)
      hooks.activity()
    },
    onSelectionUpdate: ({ editor }) => updateToolbars(editor),
    onUpdate: ({ editor }) => {
      refreshEmptyState(element, editor)
      updateToolbars(editor)
      hooks.activity()
    },
    onBlur: ({ editor }) => {
      hideToolbars()
      refreshEmptyState(element, editor)
      const html = editor.getHTML()
      if (html === committedHtml) return
      committedHtml = html
      hooks.commit(element, html)
    },
  })
  setEditorFormatting(editor, config)
  editorsByElement.set(element, editor)
}

/**
 * Mount an editor on every inline-editable property under `root` - except
 * inside shine-through elements (existing here only via dimension fallback):
 * those are read-only until the editor explicitly creates the variant (the
 * "Create variant" button); an implicit variant-on-edit would be too subtle
 * for a consequence of that weight.
 */
export function mountRichTextEditors(
  root: ParentNode,
  hooks: RichTextHooks,
): void {
  injectEditorStyles()
  for (const element of root.querySelectorAll<HTMLElement>(
    `[${PROPERTY_ATTRIBUTE}]`,
  )) {
    if (element.closest(`[${SHINE_THROUGH_ATTRIBUTE}]`)) continue
    mountEditor(element, hooks)
  }
}
