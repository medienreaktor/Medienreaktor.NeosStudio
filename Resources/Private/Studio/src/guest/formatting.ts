/**
 * Translates a property's Neos inline-editing configuration into a TipTap
 * schema and a normalized capability set the toolbar reads.
 *
 * The edit-mode markup carries the config as data-__neos-studio-formatting
 * (see Root.fusion / StudioHelper.inlineFormatting): the NodeType's
 * `formatting` flags (strong, em, h1..h6, ol, ul, a, ...) plus `autoparagraph`.
 * We map those onto TipTap extensions so a property only permits what its
 * NodeType declares - matching how the classic UI constrains CKEditor - and
 * expose the same flags to the toolbar so it shows only the allowed buttons.
 */
import { Editor, type Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Document } from '@tiptap/extension-document'
import { Text } from '@tiptap/extension-text'
import { Bold } from '@tiptap/extension-bold'
import { Italic } from '@tiptap/extension-italic'
import { Underline } from '@tiptap/extension-underline'
import { Strike } from '@tiptap/extension-strike'
import { Code } from '@tiptap/extension-code'
import { Link } from '@tiptap/extension-link'
import { HardBreak } from '@tiptap/extension-hard-break'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { TextAlign } from '@tiptap/extension-text-align'

const FORMATTING_ATTRIBUTE = 'data-__neos-studio-formatting'

/** The normalized set of what a property permits; drives schema and toolbar. */
export interface Formatting {
  // Marks
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  code: boolean
  subscript: boolean
  superscript: boolean
  link: boolean
  // Blocks
  paragraph: boolean
  headingLevels: number[]
  codeBlock: boolean
  blockquote: boolean
  bulletList: boolean
  orderedList: boolean
  alignment: boolean
  // Actions
  removeFormat: boolean
  horizontalRule: boolean
  // Derived
  /** Whether the schema has block nodes (vs. a single inline-only line). */
  block: boolean
  /** Whether more than one top-level block is allowed (autoparagraph). */
  multiline: boolean
}

/** No config attribute → a permissive default matching a typical rich text. */
const DEFAULT_FORMATTING: Formatting = {
  bold: true,
  italic: true,
  underline: true,
  strike: true,
  code: false,
  subscript: false,
  superscript: false,
  link: true,
  paragraph: true,
  headingLevels: [1, 2, 3],
  codeBlock: false,
  blockquote: true,
  bulletList: true,
  orderedList: true,
  alignment: false,
  removeFormat: true,
  horizontalRule: true,
  block: true,
  multiline: true,
}

interface RawConfig {
  formatting?: Record<string, unknown>
  autoparagraph?: unknown
}

/** Read and normalize a property element's formatting config. */
export function parseFormatting(element: HTMLElement): Formatting {
  const raw = element.getAttribute(FORMATTING_ATTRIBUTE)
  if (!raw) return DEFAULT_FORMATTING
  let config: RawConfig
  try {
    config = JSON.parse(raw) as RawConfig
  } catch {
    return DEFAULT_FORMATTING
  }
  const f = config.formatting ?? {}
  const on = (key: string): boolean => f[key] === true
  const headingLevels = [1, 2, 3, 4, 5, 6].filter((level) => on(`h${level}`))
  const paragraph = f.p !== false
  const alignment = on('left') || on('right') || on('center') || on('justify')
  const block =
    paragraph ||
    headingLevels.length > 0 ||
    on('pre') ||
    on('blockquote') ||
    on('ol') ||
    on('ul')
  return {
    bold: on('strong'),
    italic: on('em'),
    underline: on('underline'),
    strike: on('strikethrough'),
    code: on('code'),
    subscript: on('sub'),
    superscript: on('sup'),
    link: on('a'),
    paragraph,
    headingLevels,
    codeBlock: on('pre'),
    blockquote: on('blockquote'),
    bulletList: on('ul'),
    orderedList: on('ol'),
    alignment,
    removeFormat: on('removeFormat'),
    // Neos has no dedicated hr flag; offer it wherever the schema has blocks.
    horizontalRule: block,
    block,
    // autoparagraph false (or a single-line title with p:false) stays one block.
    multiline: config.autoparagraph !== false && paragraph,
  }
}

/** The TipTap extension set (schema) for a resolved config. */
export function extensionsFor(config: Formatting): Extensions {
  const marks: Extensions = []
  if (config.subscript) marks.push(Subscript)
  if (config.superscript) marks.push(Superscript)

  if (!config.block) {
    // Inline-only: a single line of text with marks, no block nodes, so the
    // value round-trips as bare inline HTML (e.g. a heading or span property).
    return [
      Document.extend({ content: 'inline*' }),
      Text,
      HardBreak,
      ...(config.bold ? [Bold] : []),
      ...(config.italic ? [Italic] : []),
      ...(config.underline ? [Underline] : []),
      ...(config.strike ? [Strike] : []),
      ...(config.code ? [Code] : []),
      ...(config.link ? [Link.configure({ openOnClick: false })] : []),
      ...marks,
    ]
  }

  // Block schema: StarterKit with each sub-extension toggled by the config.
  // Paragraph stays enabled as the baseline block even when `p` is false, so
  // the editor always has a valid default node; the toolbar hides the
  // paragraph button in that case. A non-multiline property overrides the
  // document to a single block so Enter cannot add paragraphs.
  return [
    StarterKit.configure({
      // Disable StarterKit's document for single-line properties; a custom
      // single-block Document is added below. undefined keeps the default.
      document: config.multiline ? undefined : false,
      heading: config.headingLevels.length
        ? { levels: config.headingLevels as (1 | 2 | 3 | 4 | 5 | 6)[] }
        : false,
      bold: config.bold ? {} : false,
      italic: config.italic ? {} : false,
      underline: config.underline ? {} : false,
      strike: config.strike ? {} : false,
      code: config.code ? {} : false,
      codeBlock: config.codeBlock ? {} : false,
      blockquote: config.blockquote ? {} : false,
      bulletList: config.bulletList ? {} : false,
      orderedList: config.orderedList ? {} : false,
      link: config.link ? { openOnClick: false } : false,
    }),
    ...(config.multiline ? [] : [Document.extend({ content: 'block' })]),
    ...(config.alignment
      ? [TextAlign.configure({ types: ['heading', 'paragraph'] })]
      : []),
    ...marks,
  ]
}

/** Per-editor config, so toolbar items can gate on the property's capabilities. */
const configByEditor = new WeakMap<Editor, Formatting>()

export function setEditorFormatting(editor: Editor, config: Formatting): void {
  configByEditor.set(editor, config)
}

export function editorFormatting(editor: Editor): Formatting {
  return configByEditor.get(editor) ?? DEFAULT_FORMATTING
}
