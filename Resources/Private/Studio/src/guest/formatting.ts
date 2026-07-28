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
 *
 * The markup carries one flag the NodeType cannot know: Neos.Neos:Editable's
 * `block` prop, as data-__neos-studio-inline. It overrides the NodeType config
 * wherever the two disagree, because it describes the markup the value is
 * rendered into, not what an editor would like to allow.
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
import { Link, type LinkOptions } from '@tiptap/extension-link'
import { HardBreak } from '@tiptap/extension-hard-break'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { TextAlign } from '@tiptap/extension-text-align'
import { TableKit } from '@tiptap/extension-table'
import { resolveStyles, styleExtensions, type ResolvedStyle } from './styles'

const FORMATTING_ATTRIBUTE = 'data-__neos-studio-formatting'
const INLINE_ATTRIBUTE = 'data-__neos-studio-inline'

/**
 * The Link extension's Studio configuration, used by both schema branches.
 * Neos stores document and asset links as node:// and asset:// URIs in the
 * property HTML; TipTap validates hrefs against a protocol allow-list (when
 * parsing existing content too), so without registering the custom schemes it
 * would silently strip those link marks - and the next commit would save the
 * content unlinked. The HTMLAttributes reset drops TipTap's defaults
 * (target="_blank" rel="noopener noreferrer nofollow" on every link): what a
 * link carries is exactly what was configured in the Link Editor, nothing is
 * injected into the stored markup.
 */
const LINK_CONFIGURATION: Partial<LinkOptions> = {
  openOnClick: false,
  protocols: ['node', 'asset'],
  HTMLAttributes: { target: null, rel: null },
}

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
  table: boolean
  alignment: boolean
  // Actions
  removeFormat: boolean
  horizontalRule: boolean
  /**
   * The NodeType's `styleDefinitions`, validated and resolved against the
   * flags above - the CSS classes this property lets an editor assign to
   * individual elements (see styles.ts).
   */
  styles: ResolvedStyle[]
  // Derived
  /** Whether the schema has block nodes (vs. a single inline-only line). */
  block: boolean
  /** Whether more than one top-level block is allowed (autoparagraph). */
  multiline: boolean
}

/** No config attribute → a permissive default matching a typical rich text. */
export const DEFAULT_FORMATTING: Formatting = {
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
  table: false,
  alignment: false,
  removeFormat: true,
  horizontalRule: true,
  styles: [],
  block: true,
  multiline: true,
}

/**
 * Strip everything block-level from a capability set: what is left is a single
 * line of text with marks. Applied to properties whose Neos.Neos:Editable
 * declares `block = false` (data-__neos-studio-inline), which the site renders
 * as a <span> inside a line of text - a paragraph, heading, list or table
 * written there would be broken markup, however the NodeType's `formatting`
 * flags read. Marks (bold, link, sub/sup, ...) stay untouched, and so are the
 * style definitions that address them; block styles go with their blocks.
 */
function withoutBlocks(config: Formatting): Formatting {
  return {
    ...config,
    paragraph: false,
    headingLevels: [],
    codeBlock: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
    table: false,
    alignment: false,
    horizontalRule: false,
    styles: config.styles.filter((style) => style.target.kind === 'mark'),
    block: false,
    multiline: false,
  }
}

export interface RawFormattingConfig {
  formatting?: Record<string, unknown>
  autoparagraph?: unknown
}

/** Read and normalize a property element's formatting config. */
export function parseFormatting(element: HTMLElement): Formatting {
  // An inline editable is inline whatever its formatting config says - and
  // notably also when it has none at all, where the permissive default would
  // otherwise hand a <span> property paragraphs, headings and lists.
  const inline = element.hasAttribute(INLINE_ATTRIBUTE)
  const fallback = inline
    ? withoutBlocks(DEFAULT_FORMATTING)
    : DEFAULT_FORMATTING
  const raw = element.getAttribute(FORMATTING_ATTRIBUTE)
  if (!raw) return fallback
  let config: RawFormattingConfig
  try {
    config = JSON.parse(raw) as RawFormattingConfig
  } catch {
    return fallback
  }
  return normalizeFormatting(config, inline)
}

/**
 * Normalize raw Neos formatting flags into the capability set - shared by the
 * inline editors (config from the edit-mode markup) and the inspector's
 * RichTextEditor (config from ui.inspector.editorOptions). `inline` forces the
 * single-line, block-free result the enclosing markup requires.
 */
export function normalizeFormatting(
  config: RawFormattingConfig,
  inline = false,
): Formatting {
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
    on('ul') ||
    on('table')
  const normalized: Formatting = {
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
    table: on('table'),
    alignment,
    removeFormat: on('removeFormat'),
    // Neos has no dedicated hr flag; offer it wherever the schema has blocks.
    horizontalRule: block,
    // Resolved below, once the enclosing markup has had its say.
    styles: [],
    block,
    // autoparagraph false (or a single-line title with p:false) stays one block.
    multiline: config.autoparagraph !== false && paragraph,
  }

  // Style definitions are resolved last, against the *final* capability set:
  // a definition whose element the property does not permit is dead config,
  // and for an inline editable that includes everything block-level.
  const resolved = inline ? withoutBlocks(normalized) : normalized
  return { ...resolved, styles: resolveStyles(f.styleDefinitions, resolved) }
}

/** The TipTap extension set (schema) for a resolved config. */
export function extensionsFor(config: Formatting): Extensions {
  const marks: Extensions = []
  if (config.subscript) marks.push(Subscript)
  if (config.superscript) marks.push(Superscript)
  // The `class` attribute the property's style definitions need to survive a
  // round trip, plus a mark per inline element that had none (see styles.ts).
  const styles: Extensions = styleExtensions(config.styles)

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
      ...(config.link ? [Link.configure(LINK_CONFIGURATION)] : []),
      ...marks,
      ...styles,
    ]
  }

  // Block schema: StarterKit with each sub-extension toggled by the config.
  // Paragraph stays enabled as the baseline block even when `p` is false, so
  // the editor always has a valid default node; the toolbar hides the
  // paragraph button in that case. A non-multiline property overrides the
  // document to a single block so Enter cannot add paragraphs.
  return [
    StarterKit.configure({
      // No drop cursor: Neos node drags (element handle / creation panel) must
      // never target the editor, so it must not present a drop position. The
      // editor also blocks drag/drop DOM events (see richtext.ts).
      dropcursor: false,
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
      link: config.link ? LINK_CONFIGURATION : false,
    }),
    ...(config.multiline ? [] : [Document.extend({ content: 'block' })]),
    ...(config.alignment
      ? [TextAlign.configure({ types: ['heading', 'paragraph'] })]
      : []),
    ...(config.table
      ? [TableKit.configure({ table: { resizable: true } })]
      : []),
    ...marks,
    ...styles,
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
