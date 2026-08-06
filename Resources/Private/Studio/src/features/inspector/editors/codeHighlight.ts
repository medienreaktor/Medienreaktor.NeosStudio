/**
 * A tiny, dependency-free syntax highlighter for the CodeEditor. It turns a
 * raw source string into escaped HTML with color spans, meant to sit in a
 * <pre> behind a transparent <textarea> (see CodeEditor's overlay). Because the
 * output is injected via innerHTML, every code fragment is HTML-escaped before
 * a span wraps it - the highlighter never emits untrusted markup.
 *
 * It is deliberately not a full parser: two modes (markup for HTML/XML, and a
 * generic tokenizer for everything else) cover the CodeEditor's cases - raw
 * HTML blocks and pure code snippets - well enough to read, and degrade to
 * plain escaped text rather than mis-highlighting exotic input. The class names
 * are literal Tailwind utilities so the scanner keeps them in the bundle; they
 * lean on the Neos palette ramps (see styles.css).
 */

const COLOR = {
  punct: 'text-neutral-500',
  tag: 'text-blue-600 dark:text-blue-400',
  attr: 'text-orange-700 dark:text-orange-300',
  string: 'text-green-600 dark:text-green-400',
  comment: 'text-neutral-500 italic',
  entity: 'text-orange-600 dark:text-orange-400',
  number: 'text-orange-600 dark:text-orange-400',
  keyword: 'text-blue-600 dark:text-blue-400',
} as const

/** Highlighting mode; markup is the default since the editor is HTML-first. */
export type HighlightMode = 'markup' | 'code'

/**
 * Resolve a CodeMirror-style `highlightingMode` option (a MIME type, as Neos
 * node type configuration writes it) to one of our two modes. Anything HTML- or
 * XML-flavored highlights as markup; everything else (CSS, JS, JSON, PHP, YAML,
 * plain text) goes through the generic code tokenizer. Unset defaults to markup.
 */
export function resolveHighlightMode(mode: string | undefined): HighlightMode {
  if (!mode) return 'markup'
  return /html|xml/i.test(mode) ? 'markup' : 'code'
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c])
}

/** Wrap already-known-plain text in a color span (escaping it first). */
function span(className: string, text: string): string {
  return `<span class="${className}">${escapeHtml(text)}</span>`
}

/** Escape a run of body text, coloring any HTML entities within it. */
function highlightText(text: string): string {
  let out = ''
  let last = 0
  const entity = /&#?[a-zA-Z0-9]+;/g
  let match: RegExpExecArray | null
  while ((match = entity.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, match.index))
    out += span(COLOR.entity, match[0])
    last = entity.lastIndex
  }
  return out + escapeHtml(text.slice(last))
}

/** Highlight one full tag, e.g. `<a href="/x" class='y'>` or `</p>` or `<br/>`. */
function highlightTag(raw: string): string {
  const open = /^<\/?/.exec(raw)![0]
  const name = /^<\/?([a-zA-Z][\w:-]*)?/.exec(raw)![1] ?? ''
  let out = span(COLOR.punct, open)
  if (name) out += span(COLOR.tag, name)

  const rest = raw.slice(open.length + name.length)
  // Attribute names, `=`, quoted/unquoted values, and the closing `>` / `/>`.
  // `expectValue` tracks the token right after an `=`, so unquoted values color
  // as strings rather than as another attribute name.
  const token =
    /("[^"]*"|'[^']*')|(\/?>)|([a-zA-Z_:][\w:.-]*)|(=)|(\s+)|([\s\S])/g
  let expectValue = false
  let match: RegExpExecArray | null
  while ((match = token.exec(rest)) !== null) {
    const [whole, quoted, close, ident, equals, space] = match
    if (quoted) {
      out += span(COLOR.string, quoted)
      expectValue = false
    } else if (close) {
      out += span(COLOR.punct, close)
    } else if (ident) {
      out += span(expectValue ? COLOR.string : COLOR.attr, ident)
      expectValue = false
    } else if (equals) {
      out += span(COLOR.punct, equals)
      expectValue = true
    } else if (space) {
      out += escapeHtml(space)
    } else {
      out += escapeHtml(whole)
    }
  }
  return out
}

function highlightMarkup(code: string): string {
  let out = ''
  let last = 0
  // Comments, CDATA/doctype/processing instructions, and element tags.
  const structure =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/?[a-zA-Z][^>]*>/g
  let match: RegExpExecArray | null
  while ((match = structure.exec(code)) !== null) {
    out += highlightText(code.slice(last, match.index))
    const chunk = match[0]
    if (chunk.startsWith('<!--') || chunk.startsWith('<?')) {
      out += span(COLOR.comment, chunk)
    } else if (chunk.startsWith('<!')) {
      out += span(COLOR.punct, chunk)
    } else {
      out += highlightTag(chunk)
    }
    last = structure.lastIndex
  }
  return out + highlightText(code.slice(last))
}

const KEYWORDS = new Set([
  'abstract', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
  'continue', 'default', 'delete', 'do', 'echo', 'else', 'enum', 'export',
  'extends', 'false', 'final', 'finally', 'fn', 'for', 'from', 'function',
  'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'namespace',
  'new', 'null', 'of', 'private', 'protected', 'public', 'return', 'static',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined',
  'use', 'var', 'void', 'while', 'yield',
])

function highlightCode(code: string): string {
  let out = ''
  let last = 0
  // Line and block comments; single/double/backtick strings; numbers; words.
  const token =
    /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d[\w.]*\b)|([A-Za-z_$][\w$]*)/g
  let match: RegExpExecArray | null
  while ((match = token.exec(code)) !== null) {
    out += escapeHtml(code.slice(last, match.index))
    const [whole, comment, str, num, word] = match
    if (comment) out += span(COLOR.comment, comment)
    else if (str) out += span(COLOR.string, str)
    else if (num) out += span(COLOR.number, num)
    else if (word && KEYWORDS.has(word)) out += span(COLOR.keyword, word)
    else out += escapeHtml(whole)
    last = token.lastIndex
  }
  return out + escapeHtml(code.slice(last))
}

/** Highlight `code` in the given mode, returning escaped HTML with color spans. */
export function highlight(code: string, mode: HighlightMode): string {
  return mode === 'markup' ? highlightMarkup(code) : highlightCode(code)
}
