/**
 * Rich-text link editing across the iframe boundary. The Link Editor dialog
 * needs the shell (document tree, Media Library, auth), so the guest only
 * starts and finishes the edit:
 *
 * - The toolbar's link button calls requestLinkEdit: the selection is
 *   extended over the whole existing link (if any), remembered as the pending
 *   edit, and a link-edit-request with the current attributes goes to the
 *   host, which opens the dialog.
 * - The host answers with link-apply (set or remove the link mark on the
 *   remembered selection) or link-cancel (just refocus). Opening the dialog
 *   inevitably blurs the editor - the remembered from/to survive that.
 *
 * One pending edit at a time, matching the one modal the host shows. A
 * preview reload between request and answer simply drops the pending edit
 * (the fresh guest has none); a stray answer is ignored.
 */
import type { Editor } from '@tiptap/core'
import type {
  GuestToHostMessage,
  LinkAttributes,
} from '../features/preview/protocol'

let pending: { editor: Editor; from: number; to: number } | null = null

function post(message: GuestToHostMessage): void {
  window.parent.postMessage(message, window.location.origin)
}

/** The selection's current link attributes, or null when it is not linked. */
function currentAttributes(editor: Editor): LinkAttributes | null {
  if (!editor.isActive('link')) return null
  const attrs = editor.getAttributes('link')
  if (typeof attrs.href !== 'string' || attrs.href === '') return null
  const str = (value: unknown): string | null =>
    typeof value === 'string' && value !== '' ? value : null
  return {
    href: attrs.href,
    target: str(attrs.target),
    rel: str(attrs.rel),
    class: str(attrs.class),
    title: str(attrs.title),
  }
}

/** Start a link edit for the editor's selection - asks the host for the dialog. */
export function requestLinkEdit(editor: Editor): void {
  // Editing an existing link works from anywhere inside it: widen the
  // selection to the whole link first, so the new attributes replace it
  // entirely instead of splitting it.
  if (editor.isActive('link')) {
    editor.chain().extendMarkRange('link').run()
  }
  const { from, to } = editor.state.selection
  // Nothing to hang a link on: no text selected and not inside a link.
  if (from === to) return
  pending = { editor, from, to }
  post({
    type: 'neos-studio/link-edit-request',
    attributes: currentAttributes(editor),
  })
}

/** The host confirmed the dialog: (re)link or unlink the pending selection. */
export function applyLinkEdit(attributes: LinkAttributes | null): void {
  if (pending === null) return
  const { editor, from, to } = pending
  pending = null
  if (editor.isDestroyed) return
  const chain = editor
    .chain()
    .focus()
    .setTextSelection({ from, to })
    .extendMarkRange('link')
  if (attributes === null || attributes.href === '') {
    chain.unsetLink().run()
  } else {
    chain
      .setLink({
        href: attributes.href,
        target: attributes.target,
        rel: attributes.rel,
        class: attributes.class,
        title: attributes.title,
      })
      .run()
  }
}

/** The host dismissed the dialog: back to editing, selection restored. */
export function cancelLinkEdit(): void {
  if (pending === null) return
  const { editor, from, to } = pending
  pending = null
  if (editor.isDestroyed) return
  editor.chain().focus().setTextSelection({ from, to }).run()
}
