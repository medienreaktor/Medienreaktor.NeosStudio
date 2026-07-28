/**
 * Style definitions: the CSS classes an editor may put on individual elements
 * of a rich-text property, configured in the NodeType.
 *
 * This is the classic UI's CKEditor "Style" feature, reimplemented on TipTap
 * and reading the exact same configuration, so a site's NodeTypes need no
 * Studio-specific keys:
 *
 *     properties.text.ui.inline.editorOptions.formatting.styleDefinitions:
 *       - name: 'Lead paragraph'
 *         element: 'p'
 *         classes: ['lead']
 *       - name: 'Yellow marker'
 *         element: 'span'
 *         classes: ['marker', 'marker--yellow']
 *
 * As in CKEditor, whether a definition is a *block* or an *inline* style is
 * derived from its `element`, not declared: block elements map onto TipTap
 * nodes (p -> paragraph, h2 -> heading level 2, ...) and get their classes on
 * the node itself; everything else is inline and maps onto a mark - a built-in
 * one where the element has a counterpart (strong -> bold, a -> link, ...),
 * otherwise a mark generated on the fly for that tag (span, mark, abbr, ...).
 *
 * CKEditor gets `class` through the whole pipeline via GeneralHtmlSupport,
 * which is always loaded there. TipTap has no equivalent: a schema silently
 * drops every attribute it does not declare, so the classes only survive a
 * round trip because this module declares a `class` attribute on exactly the
 * nodes and marks the definitions target. That attribute is a *whitelist* - it
 * keeps only classes some definition configured, so pasted markup cannot smuggle
 * arbitrary classes into the stored property value.
 */
import { Extension, Mark, mergeAttributes, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/** A style definition exactly as configured in the NodeType. */
export interface StyleDefinition {
  name: string
  element: string
  classes: string[]
}

/** What a definition's classes are applied to. */
export type StyleTarget =
  | { kind: 'node'; name: string; attrs?: Record<string, unknown> }
  | { kind: 'mark'; name: string }

/** A validated definition, resolved against the property's capabilities. */
export interface ResolvedStyle {
  /** The configured name; the menu label and the definition's stable key. */
  name: string
  /** The configured element, lowercased - also the preview's tag. */
  element: string
  classes: string[]
  target: StyleTarget
}

/**
 * Block elements and the TipTap node they address. Headings are one node with
 * a `level` attribute, so h1..h6 differ only in the attrs they match on.
 */
const BLOCK_NODES: Record<string, StyleTarget & { kind: 'node' }> = {
  p: { kind: 'node', name: 'paragraph' },
  h1: { kind: 'node', name: 'heading', attrs: { level: 1 } },
  h2: { kind: 'node', name: 'heading', attrs: { level: 2 } },
  h3: { kind: 'node', name: 'heading', attrs: { level: 3 } },
  h4: { kind: 'node', name: 'heading', attrs: { level: 4 } },
  h5: { kind: 'node', name: 'heading', attrs: { level: 5 } },
  h6: { kind: 'node', name: 'heading', attrs: { level: 6 } },
  pre: { kind: 'node', name: 'codeBlock' },
  blockquote: { kind: 'node', name: 'blockquote' },
  ul: { kind: 'node', name: 'bulletList' },
  ol: { kind: 'node', name: 'orderedList' },
  li: { kind: 'node', name: 'listItem' },
  table: { kind: 'node', name: 'table' },
  tr: { kind: 'node', name: 'tableRow' },
  td: { kind: 'node', name: 'tableCell' },
  th: { kind: 'node', name: 'tableHeader' },
}

/**
 * Block-level elements with no node in the Studio schema. They must be
 * recognized all the same: left to the inline branch below they would be
 * turned into a mark, and a style that wraps a paragraph in an inline <div>
 * is worse than a style that is reported as unsupported.
 */
const UNSUPPORTED_BLOCKS = new Set([
  'address',
  'article',
  'aside',
  'caption',
  'col',
  'colgroup',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'header',
  'hr',
  'main',
  'nav',
  'section',
  'summary',
  'tbody',
  'tfoot',
  'thead',
])

/** Inline elements the schema already has a mark for. */
const INLINE_MARKS: Record<string, string> = {
  a: 'link',
  b: 'bold',
  code: 'code',
  del: 'strike',
  em: 'italic',
  i: 'italic',
  s: 'strike',
  strike: 'strike',
  strong: 'bold',
  sub: 'subscript',
  sup: 'superscript',
  u: 'underline',
}

/** The name of the mark generated for an inline element without a built-in. */
function generatedMarkName(element: string): string {
  return `studioStyle_${element}`
}

/**
 * The capability flags a resolved style is checked against - the subset of
 * `Formatting` this module needs, so the two do not depend on each other.
 */
export interface StyleCapabilities {
  block: boolean
  headingLevels: number[]
  codeBlock: boolean
  blockquote: boolean
  bulletList: boolean
  orderedList: boolean
  table: boolean
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  code: boolean
  subscript: boolean
  superscript: boolean
  link: boolean
}

/** Whether the property's schema actually contains a target's node or mark. */
function targetIsInSchema(
  target: StyleTarget,
  capabilities: StyleCapabilities,
): boolean {
  if (target.kind === 'node') {
    // Every block schema has a paragraph, even where `p: false` hides the
    // toolbar button - the text still lives in paragraphs and may be styled.
    if (!capabilities.block) return false
    switch (target.name) {
      case 'paragraph':
        return true
      case 'heading':
        return capabilities.headingLevels.includes(
          Number(target.attrs?.level ?? 0),
        )
      case 'codeBlock':
        return capabilities.codeBlock
      case 'blockquote':
        return capabilities.blockquote
      case 'bulletList':
        return capabilities.bulletList
      case 'orderedList':
        return capabilities.orderedList
      case 'listItem':
        return capabilities.bulletList || capabilities.orderedList
      case 'table':
      case 'tableRow':
      case 'tableCell':
      case 'tableHeader':
        return capabilities.table
      default:
        return false
    }
  }
  switch (target.name) {
    case 'bold':
      return capabilities.bold
    case 'italic':
      return capabilities.italic
    case 'underline':
      return capabilities.underline
    case 'strike':
      return capabilities.strike
    case 'code':
      return capabilities.code
    case 'subscript':
      return capabilities.subscript
    case 'superscript':
      return capabilities.superscript
    case 'link':
      return capabilities.link
    // A generated mark exists precisely because a definition asked for it.
    default:
      return true
  }
}

const ELEMENT_PATTERN = /^[a-z][a-z0-9]*$/

/**
 * Validate and resolve raw `styleDefinitions` against what a property permits.
 * Definitions that are malformed, address an element with no counterpart in the
 * Studio schema, or target something the property does not allow are dropped -
 * an `element: 'h2'` style on a property without h2 is dead configuration.
 */
export function resolveStyles(
  raw: unknown,
  capabilities: StyleCapabilities,
): ResolvedStyle[] {
  if (!Array.isArray(raw)) return []
  const resolved: ResolvedStyle[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const candidate = entry as Record<string, unknown>
    // Unquoted YAML scalars arrive as numbers and booleans through
    // json_encode, so every value is coerced at this boundary.
    const name = String(candidate.name ?? '').trim()
    const element = String(candidate.element ?? '')
      .trim()
      .toLowerCase()
    const classes = Array.isArray(candidate.classes)
      ? candidate.classes.map((value) => String(value).trim()).filter(Boolean)
      : []
    if (!name || !element || classes.length === 0) {
      warn(`ignoring an incomplete style definition (${name || 'unnamed'})`)
      continue
    }
    if (!ELEMENT_PATTERN.test(element)) {
      warn(`ignoring the style "${name}": "${element}" is not an element name`)
      continue
    }
    if (seen.has(name)) {
      warn(`ignoring a second style named "${name}"`)
      continue
    }
    if (UNSUPPORTED_BLOCKS.has(element)) {
      warn(`ignoring the style "${name}": <${element}> is not editable content`)
      continue
    }
    const target: StyleTarget =
      BLOCK_NODES[element] ??
      (INLINE_MARKS[element]
        ? { kind: 'mark', name: INLINE_MARKS[element] }
        : { kind: 'mark', name: generatedMarkName(element) })
    seen.add(name)
    if (!targetIsInSchema(target, capabilities)) continue
    resolved.push({ name, element, classes, target })
  }
  return resolved
}

function warn(message: string): void {
  console.warn(`[Neos Studio] styleDefinitions: ${message}`)
}

// --- Schema ----------------------------------------------------------------

/** A target's identity, for grouping definitions that share one attribute. */
function targetKey(target: StyleTarget): string {
  return target.kind === 'node' ? `node:${target.name}` : `mark:${target.name}`
}

/**
 * The `class` attribute for one node or mark type, whitelisted to the classes
 * its definitions configured: anything else in the parsed markup is dropped,
 * the way CKEditor only lets GeneralHtmlSupport through for what the Style
 * feature registered.
 */
function classAttribute(allowed: Set<string>) {
  return {
    default: null as string | null,
    parseHTML: (element: HTMLElement): string | null => {
      const kept = Array.from(element.classList).filter((name) =>
        allowed.has(name),
      )
      return kept.length > 0 ? kept.join(' ') : null
    },
    renderHTML: (attributes: Record<string, unknown>) =>
      typeof attributes.class === 'string' && attributes.class !== ''
        ? { class: attributes.class }
        : {},
  }
}

/**
 * A mark that exists only to carry style classes on an inline element the
 * schema has no mark for (span, mark, abbr, ...). Without a whitelisted class
 * it does not match, so the tag never survives a round trip on its own.
 */
function generatedStyleMark(element: string, allowed: Set<string>) {
  return Mark.create({
    name: generatedMarkName(element),

    addAttributes() {
      return { class: classAttribute(allowed) }
    },

    parseHTML() {
      return [
        {
          tag: `${element}[class]`,
          getAttrs: (node) =>
            node instanceof HTMLElement &&
            Array.from(node.classList).some((name) => allowed.has(name))
              ? null
              : false,
        },
      ]
    },

    renderHTML({ HTMLAttributes }) {
      return [element, mergeAttributes(HTMLAttributes), 0]
    },
  })
}

/**
 * The extensions that make a property's style definitions work: one `class`
 * attribute per targeted node and built-in mark, plus a mark per inline
 * element that needed generating. Returns nothing when there are no styles, so
 * a property without them keeps the plain schema.
 *
 * The `link` mark is deliberately left out of the global attributes: TipTap's
 * Link already declares its own `class` attribute (the Link Editor's "CSS
 * class" field writes it), and re-declaring it would replace that with a
 * whitelisted one - so a hand-typed class on a link would silently vanish.
 * Style definitions for `a` write the very same attribute instead.
 */
export function styleExtensions(styles: ResolvedStyle[]) {
  if (styles.length === 0) return []

  const allowedByTarget = new Map<string, Set<string>>()
  for (const style of styles) {
    const key = targetKey(style.target)
    let allowed = allowedByTarget.get(key)
    if (!allowed) {
      allowed = new Set<string>()
      allowedByTarget.set(key, allowed)
    }
    for (const name of style.classes) allowed.add(name)
  }

  const generatedElements = new Map<string, Set<string>>()
  const nodeTypes = new Set<string>()
  const markTypes = new Set<string>()
  for (const style of styles) {
    const allowed = allowedByTarget.get(targetKey(style.target))!
    if (style.target.kind === 'node') {
      nodeTypes.add(style.target.name)
    } else if (style.target.name === generatedMarkName(style.element)) {
      generatedElements.set(style.element, allowed)
    } else if (style.target.name !== 'link') {
      markTypes.add(style.target.name)
    }
  }

  const attributes = Extension.create({
    name: 'studioStyleAttributes',

    addGlobalAttributes() {
      return [...nodeTypes, ...markTypes].map((type) => ({
        types: [type],
        attributes: {
          class: classAttribute(
            allowedByTarget.get(
              nodeTypes.has(type) ? `node:${type}` : `mark:${type}`,
            ) ?? new Set<string>(),
          ),
        },
      }))
    },
  })

  return [
    attributes,
    ...Array.from(generatedElements, ([element, allowed]) =>
      generatedStyleMark(element, allowed),
    ),
  ]
}

// --- State and commands ----------------------------------------------------

function classList(value: unknown): string[] {
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []
}

/**
 * The class attribute a style toggle produces: the current classes with the
 * definition's added or removed. null when nothing is left, so the attribute
 * disappears from the markup instead of rendering empty.
 */
function toggledClasses(
  current: string[],
  classes: string[],
  add: boolean,
): string | null {
  const next = new Set(current)
  for (const name of classes) {
    if (add) next.add(name)
    else next.delete(name)
  }
  const list = Array.from(next)
  return list.length > 0 ? list.join(' ') : null
}

function matchesNodeTarget(
  node: ProseMirrorNode,
  target: StyleTarget & { kind: 'node' },
): boolean {
  if (node.type.name !== target.name) return false
  for (const [attribute, value] of Object.entries(target.attrs ?? {})) {
    if (node.attrs[attribute] !== value) return false
  }
  return true
}

/** The first node in the selection a block style would apply to. */
function firstNodeTarget(
  editor: Editor,
  target: StyleTarget & { kind: 'node' },
): ProseMirrorNode | null {
  const { from, to } = editor.state.selection
  let found: ProseMirrorNode | null = null
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!found && matchesNodeTarget(node, target)) found = node
  })
  return found
}

/**
 * Whether a style can be applied where the selection is: a block style needs
 * the caret in a matching block, and a style on a built-in mark needs that
 * mark to exist - a class cannot be put on a <strong> that is not there.
 * Generated marks are always applicable; applying one creates the element.
 */
export function isStyleAvailable(
  editor: Editor,
  style: ResolvedStyle,
): boolean {
  if (style.target.kind === 'node') {
    return firstNodeTarget(editor, style.target) !== null
  }
  if (style.target.name === generatedMarkName(style.element)) return true
  return editor.isActive(style.target.name)
}

/** Whether all of the definition's classes are currently applied. */
export function isStyleActive(editor: Editor, style: ResolvedStyle): boolean {
  const current =
    style.target.kind === 'node'
      ? classList(firstNodeTarget(editor, style.target)?.attrs.class)
      : classList(editor.getAttributes(style.target.name).class)
  return style.classes.every((name) => current.includes(name))
}

/** Add or remove a definition's classes at the selection. */
export function toggleStyle(editor: Editor, style: ResolvedStyle): void {
  const add = !isStyleActive(editor, style)
  if (style.target.kind === 'node') {
    toggleNodeStyle(editor, style, style.target, add)
    return
  }
  const markName = style.target.name
  const next = toggledClasses(
    classList(editor.getAttributes(markName).class),
    style.classes,
    add,
  )
  if (markName === generatedMarkName(style.element)) {
    // A generated mark is nothing but its classes: dropping the last one has
    // to remove the mark, or the bare tag would stay in the stored markup.
    if (next === null) {
      editor
        .chain()
        .focus()
        .unsetMark(markName, { extendEmptyMarkRange: true })
        .run()
    } else {
      editor.chain().focus().setMark(markName, { class: next }).run()
    }
    return
  }
  // A built-in mark keeps its own identity; only the class attribute changes.
  // extendMarkRange first, because updateAttributes needs a range to work on
  // and the caret is usually just sitting inside the mark.
  editor
    .chain()
    .focus()
    .extendMarkRange(markName)
    .updateAttributes(markName, { class: next })
    .run()
}

/**
 * Apply a block style to every matching node in the selection, in one
 * transaction. `updateAttributes` cannot do this: it matches on the node type
 * alone, so a style for h2 would also hit an h3 in the same selection.
 * Attribute-only markup changes leave the document size untouched, so the
 * positions collected while walking stay valid as the transaction is built.
 */
function toggleNodeStyle(
  editor: Editor,
  style: ResolvedStyle,
  target: StyleTarget & { kind: 'node' },
  add: boolean,
): void {
  const { state, view } = editor
  const { from, to } = state.selection
  const transaction = state.tr
  let changed = false
  state.doc.nodesBetween(from, to, (node, position) => {
    if (!matchesNodeTarget(node, target)) return
    transaction.setNodeMarkup(position, undefined, {
      ...node.attrs,
      class: toggledClasses(classList(node.attrs.class), style.classes, add),
    })
    changed = true
  })
  if (changed) view.dispatch(transaction)
  editor.commands.focus()
}

// --- Previews --------------------------------------------------------------

/**
 * Wrappers for elements the HTML parser will not accept on their own: a bare
 * <li> or <td> assigned through innerHTML is simply dropped, so its preview
 * would come out empty.
 */
const PREVIEW_WRAPPERS: Record<string, [string, string]> = {
  li: ['<ul style="margin:0;padding-left:1.2em">', '</ul>'],
  tr: ['<table><tbody>', '</tbody></table>'],
  td: ['<table><tbody><tr>', '</tr></tbody></table>'],
  th: ['<table><tbody><tr>', '</tr></tbody></table>'],
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * A live preview of a style: its name rendered in the very element and classes
 * it would produce. Inside the preview iframe this is styled by the site's own
 * CSS, so the menu shows editors what the style actually looks like - the one
 * real advantage of a toolbar that lives in the guest document.
 */
export function stylePreviewMarkup(style: ResolvedStyle): string {
  const [before, after] = PREVIEW_WRAPPERS[style.element] ?? ['', '']
  const classes = escapeHtml(style.classes.join(' '))
  return `${before}<${style.element} class="${classes}">${escapeHtml(
    style.name,
  )}</${style.element}>${after}`
}
