/**
 * Soft hyphens and non-breaking spaces, the two invisible characters the
 * classic UI offers through Shel.Neos.Hyphens and that sites switch on per
 * property with the `hyphens` and `nbsp` editor options.
 *
 * Both are stored as plain characters (U+00AD, U+00A0), as that package does,
 * so existing content round-trips unchanged. Neither shows while editing - a
 * soft hyphen has no width until the line breaks there, a non-breaking space
 * looks like any space - so the editor marks them with decorations, which
 * live in the view only and never reach the stored markup.
 */
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

const SOFT_HYPHEN = '\u00AD'
const NON_BREAKING_SPACE = '\u00A0'

const MARKER_CLASSES: Record<string, string> = {
  [SOFT_HYPHEN]: 'neos-studio-shy',
  [NON_BREAKING_SPACE]: 'neos-studio-nbsp',
}
const STYLE_ID = 'neos-studio-special-characters'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    specialCharacters: {
      insertSoftHyphen: () => ReturnType
      insertNonBreakingSpace: () => ReturnType
    }
  }
}

/**
 * The soft hyphen shows as a dash of its own width, as word processors show
 * it: legible at a glance, at the cost of the text wrapping slightly
 * differently than on the site.
 */
function injectStyles(document: Document): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .tiptap .${MARKER_CLASSES[SOFT_HYPHEN]}::after {
      content: '-';
      color: rgb(0, 173, 238);
      pointer-events: none;
    }
    .tiptap .${MARKER_CLASSES[NON_BREAKING_SPACE]} {
      background: rgba(0, 173, 238, 0.25);
      border-radius: 2px;
    }
  `
  document.head.appendChild(style)
}

function markers(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, position) => {
    if (!node.text) return
    for (const match of node.text.matchAll(/[\u00AD\u00A0]/g)) {
      const from = position + match.index
      decorations.push(
        Decoration.inline(from, from + 1, { class: MARKER_CLASSES[match[0]] }),
      )
    }
  })
  return DecorationSet.create(doc, decorations)
}

export const SpecialCharacters = Extension.create({
  name: 'specialCharacters',

  addCommands() {
    return {
      insertSoftHyphen:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: 'text', text: SOFT_HYPHEN }),
      insertNonBreakingSpace:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: 'text', text: NON_BREAKING_SPACE }),
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: (state) => markers(state.doc),
        },
        view: (view) => {
          injectStyles(view.dom.ownerDocument)
          return {}
        },
      }),
    ]
  },
})
