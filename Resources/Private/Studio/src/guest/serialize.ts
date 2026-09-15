/**
 * Serializes an editor's content into the HTML Neos stores.
 *
 * TipTap's (ProseMirror's) schema gives list items and table cells the
 * content model `paragraph block*`, so getHTML() wraps their text in <p>:
 * <li><p>text</p></li>. Neos stores CKEditor 5's data format, which keeps
 * those containers flat (<li>text</li>, <td>text</td>) and only emits <p>
 * inside them when an item really holds several paragraphs. Persisting the
 * wrapped form would leak <p> tags into every existing list on first edit -
 * markup the site's CSS has never seen.
 *
 * The same holds for the document itself where the NodeType sets
 * `autoparagraph: false`: the schema still needs a block to hold the text,
 * but CKEditor stores that text bare (`Title`, not `<p>Title</p>`), and the
 * site renders it into markup of its own.
 *
 * So every read that leaves the editor (commit, live-typing stream, the
 * committed baseline) goes through here instead of getHTML(): the ProseMirror
 * document keeps its internal paragraphs, and the sole paragraph of a list
 * item, table cell or non-autoparagraph document is unwrapped on the way out.
 * Reading needs no inverse - ProseMirror's parser wraps loose inline content
 * back into paragraphs by itself - and since peers run the same serializer +
 * parser, live-stream caret positions still map onto identical documents.
 */
import type { Editor } from '@tiptap/core'
import type { Formatting } from './formatting'

/** True for a <p> that carries no attributes (a class from a style
 * definition, or a text-align, must survive - CKEditor keeps those too). */
function isPlainParagraph(node: Element | null): node is HTMLParagraphElement {
  return node !== null && node.tagName === 'P' && node.attributes.length === 0
}

function isMeaninglessText(node: ChildNode): boolean {
  return node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()
}

/**
 * Unwrap the sole leading paragraph of a list item, table cell or document,
 * matching CKEditor's data downcast: only an attribute-less <p>, only when
 * what follows is nothing (single-block item) or nested lists (<li>text<ul>...).
 * An item with several paragraphs keeps them - that structure is real.
 */
function unwrapSoleParagraph(
  container: Element | DocumentFragment,
  nestedTags: string[],
): void {
  const paragraph = container.firstElementChild
  if (!isPlainParagraph(paragraph)) return
  // Nothing may precede the paragraph, and nothing but nested containers
  // (for <li>: sublists) may follow it - otherwise unwrapping would merge
  // sibling blocks into one text run.
  for (let node = container.firstChild; node; node = node.nextSibling) {
    if (node === paragraph || isMeaninglessText(node)) continue
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      nestedTags.includes((node as Element).tagName)
    ) {
      continue
    }
    return
  }
  paragraph.replaceWith(...paragraph.childNodes)
}

/** getHTML() normalized to the flat list/table/paragraph markup Neos stores. */
export function serializedHtml(editor: Editor, config: Formatting): string {
  const html = editor.getHTML()
  const unwrapDocument = !config.autoparagraph && html.startsWith('<p')
  if (
    !unwrapDocument &&
    !html.includes('<li') &&
    !html.includes('<td') &&
    !html.includes('<th')
  )
    return html
  const template = document.createElement('template')
  template.innerHTML = html
  for (const item of template.content.querySelectorAll('li')) {
    unwrapSoleParagraph(item, ['UL', 'OL'])
  }
  for (const cell of template.content.querySelectorAll('td, th')) {
    unwrapSoleParagraph(cell, [])
  }
  if (unwrapDocument) unwrapSoleParagraph(template.content, [])
  return template.innerHTML
}
