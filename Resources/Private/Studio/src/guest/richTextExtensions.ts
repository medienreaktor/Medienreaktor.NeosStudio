/**
 * Rich text extensions from plugins: custom marks, nodes and editor behaviour
 * plus the toolbar buttons that apply them - the counterpart of the classic
 * Neos UI's CKEditor formatting plugins.
 *
 * Both rich text surfaces read this registry: the inspector's RichTextEditor
 * (shell bundle) and inline editing in the preview (guest bundle, see
 * richtext.ts). They are separate bundles in separate windows, so each has its
 * own instance of this module and its own registry - a definition applies to
 * the surface whose registry it was registered into. A plugin reaches the
 * shell's through `window.NeosStudio` and the guest's through the
 * `window.NeosStudio` the guest publishes in the preview frame (pluginApi.ts),
 * loaded there from its `guestJavascript` bundle. Its extensions are built
 * with the `tiptap` building blocks of that same window, so they always match
 * the editor they end up in.
 *
 * Built-in formatting does not go through here: it is a single StarterKit
 * configured from the NodeType's flags, with schema variants (inline-only
 * documents, single-block documents) that do not decompose into independent
 * per-flag entries (see formatting.ts).
 *
 * A definition is gated on a key of the property's `editorOptions.formatting`
 * - the same flags the built-in formatting reads, so a NodeType enables a
 * plugin's 'highlight' exactly like `strong` or `em`. Neos passes unknown
 * keys through untouched (StudioHelper.inlineFormatting, the inspector's
 * editorOptions), and the built-in normalization ignores them.
 */
import { Editor, type AnyExtension, type EditorOptions } from '@tiptap/core'
import {
  ObservableRegistry,
  type RegistryEntry,
} from '../lib/observableRegistry'
import { extensionsFor, type Formatting } from './formatting'

/** An editor's options, apart from the extensions createRichTextEditor adds. */
export type RichTextEditorOptions = Omit<Partial<EditorOptions>, 'extensions'>

/** Which editor an extension is built for. */
export type RichTextSurface = 'inspector' | 'inline'

/** What an extension factory knows about the editor it builds for. */
export interface RichTextExtensionContext {
  /**
   * 'inspector': the inspector's RichTextEditor (also in the creation
   * dialog). 'inline': inline editing in the preview.
   */
  surface: RichTextSurface
  /**
   * The property's `editorOptions.formatting` flags as configured, keys the
   * Studio itself does not know included - a factory can read options of its
   * own from here (e.g. `highlightColors`).
   */
  formatting: Readonly<Record<string, unknown>>
  /**
   * Whether the schema has block nodes. False for a property edited as a
   * single line of inline content (rendered into a <span>, Neos.Neos:Editable
   * `block = false`): block nodes added there have no place in the document.
   */
  block: boolean
  /** Whether more than one top-level block is allowed (autoparagraph). */
  multiline: boolean
}

/** A toolbar button applying a plugin's extension. */
export interface RichTextToolbarItem {
  /** Unique within its definition. */
  id: string
  /** Tooltip and accessible label. Already translated - shown as given. */
  label: string
  /**
   * A Font Awesome icon name ('highlighter'), as for node types - the
   * inspector's toolbar renders it like its built-in buttons.
   */
  icon: string
  /**
   * The button face in the preview's inline toolbar: inline SVG markup
   * (24x24 viewBox, `currentColor`), matching its built-in buttons. The
   * preview renders the site's page, which has no icon font, so without it
   * the button shows the label's first letter.
   */
  svg?: string
  /**
   * Which of the preview's two toolbars carries the button: 'inline' (the
   * default), the bubble over a text selection with the marks, or 'block',
   * the bar at the caret's block. The inspector has a single toolbar.
   */
  kind?: 'inline' | 'block'
  /** Whether its mark/node is active at the selection (pressed look). */
  isActive?(editor: Editor): boolean
  /** Whether the button is unavailable right now (e.g. no selection). */
  isDisabled?(editor: Editor): boolean
  /** Apply it, typically `editor.chain().focus().toggleMark(...).run()`. */
  run(editor: Editor): void
}

/** A plugin's rich text extension. */
export interface RichTextExtensionDefinition extends RegistryEntry {
  /**
   * The `editorOptions.formatting` key that enables it on a property (e.g.
   * 'highlight' for `formatting: { highlight: true }`). Without one it applies
   * to every rich text property.
   */
  formatting?: string
  /**
   * The TipTap extensions to add to the editor, built with the `tiptap`
   * building blocks of the plugin API (never a bundled TipTap). Called for
   * every editor created; a factory that throws is logged and skipped, and
   * the editor is built without it.
   */
  extensions(context: RichTextExtensionContext): AnyExtension[]
  /** Toolbar buttons, shown wherever the extension is active. */
  toolbar?: RichTextToolbarItem[]
}

/**
 * The registry of rich text extensions. Ordered by `order`, which is also the
 * order of their toolbar buttons; a changed registry rebuilds the editors
 * that are not being edited.
 */
export class RichTextExtensionRegistry extends ObservableRegistry<RichTextExtensionDefinition> {
  constructor() {
    super({ sort: 'order' })
  }
}

export const richTextExtensionRegistry = new RichTextExtensionRegistry()

/** The definitions whose extensions an editor was built with. */
const definitionsByEditor = new WeakMap<
  Editor,
  readonly RichTextExtensionDefinition[]
>()

/** The plugin definitions active in an editor (for its toolbar). */
export function activeRichTextExtensions(
  editor: Editor,
): readonly RichTextExtensionDefinition[] {
  return definitionsByEditor.get(editor) ?? []
}

/** Whether a definition applies to a property's formatting config. */
function isEnabled(
  definition: RichTextExtensionDefinition,
  config: Formatting,
): boolean {
  return (
    definition.formatting === undefined ||
    config.flags[definition.formatting] === true
  )
}

/**
 * The registered extensions for a property, each factory isolated: one that
 * throws (or returns something other than an array) is logged with its id and
 * left out, so a broken plugin costs its own formatting, not the editor.
 */
function pluginExtensions(
  config: Formatting,
  surface: RichTextSurface,
): { definitions: RichTextExtensionDefinition[]; extensions: AnyExtension[] } {
  const context: RichTextExtensionContext = {
    surface,
    formatting: config.flags,
    block: config.block,
    multiline: config.multiline,
  }
  const definitions: RichTextExtensionDefinition[] = []
  const extensions: AnyExtension[] = []
  for (const definition of richTextExtensionRegistry.getAll()) {
    if (!isEnabled(definition, config)) continue
    try {
      const built = definition.extensions(context)
      if (!Array.isArray(built))
        throw new TypeError('extensions() must return an array')
      extensions.push(...built)
      definitions.push(definition)
    } catch (error) {
      console.error(
        `Rich text extension "${definition.id}" threw and was skipped:`,
        error,
      )
    }
  }
  return { definitions, extensions }
}

/**
 * Create an editor for a property: the built-in schema for its formatting
 * config plus the registered extensions it enables. Extensions that build
 * fine can still fail together - a duplicate name, a schema ProseMirror
 * rejects - which only shows when the editor is constructed. Then the error
 * is logged with the ids involved and the editor is created again with the
 * built-in schema alone: editing without the plugin's formatting beats not
 * editing at all.
 */
export function createRichTextEditor(
  options: RichTextEditorOptions,
  config: Formatting,
  surface: RichTextSurface,
): Editor {
  const { definitions, extensions } = pluginExtensions(config, surface)
  if (extensions.length > 0) {
    try {
      const editor = new Editor({
        ...options,
        extensions: [...extensionsFor(config), ...extensions],
      })
      definitionsByEditor.set(editor, definitions)
      return editor
    } catch (error) {
      console.error(
        `Rich text extensions ${definitions
          .map((definition) => `"${definition.id}"`)
          .join(', ')} broke the editor and were skipped:`,
        error,
      )
      // A failure while mounting can leave a half-built editable behind.
      if (options.element instanceof HTMLElement)
        options.element.replaceChildren()
    }
  }
  return new Editor({ ...options, extensions: extensionsFor(config) })
}

/**
 * Run a plugin toolbar callback without letting it break the toolbar: a
 * throwing one is logged with its ids and reads as `fallback`.
 */
export function guardedToolbarCall<T>(
  definition: RichTextExtensionDefinition,
  item: RichTextToolbarItem,
  call: () => T,
  fallback: T,
): T {
  try {
    return call()
  } catch (error) {
    console.error(
      `Toolbar item "${item.id}" of rich text extension "${definition.id}" threw:`,
      error,
    )
    return fallback
  }
}
