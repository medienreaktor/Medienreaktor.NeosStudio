import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import type { Editor } from '@tiptap/core'
import { Button } from '@/components/ui/button'
import { DraftField, isApplyChord } from '@/components/ui/draft-field'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { plainEditorOption } from '@/features/inspector/inspectorSchema'
import { useUnsavedDraft } from '@/features/inspector/unsavedChanges'
import { LinkEditorDialog } from '@/features/links/LinkEditorDialog'
import { linkAttributesFrom, type LinkValue } from '@/features/links/linkValue'
import {
  DEFAULT_FORMATTING,
  normalizeFormatting,
  type Formatting,
  type RawFormattingConfig,
} from '@/guest/formatting'
import {
  activeRichTextExtensions,
  createRichTextEditor,
  guardedToolbarCall,
  richTextExtensionRegistry,
  type RichTextEditorOptions,
} from '@/guest/richTextExtensions'
import { serializedHtml } from '@/guest/serialize'
import {
  isStyleActive,
  isStyleAvailable,
  toggleStyle,
  type ResolvedStyle,
} from '@/guest/styles'
import { faClassName } from '@/components/ui/icon'
import { useLatestRef } from '@/hooks/use-latest-ref'
import { useRegistry } from '@/lib/registry'
import { cn } from '@/lib/utils'
import { translate as t } from '@/lib/i18n'
import type { PropertyEditorComponent, PropertyEditorProps } from './registry'

export const RICH_TEXT_EDITOR = 'Neos.Neos/Inspector/Editors/RichTextEditor'

/**
 * The inspector's rich text editor: the same TipTap engine that powers inline
 * editing in the preview (same schema mapping, so a property permits exactly
 * what its NodeType's `formatting` flags declare), mounted as an inspector
 * field with a persistent toolbar. Commits serializedHtml() explicitly - on
 * mod+Enter or the inline apply button; Escape or the revert button restores
 * the last committed markup (see DraftField). Leaving the editor does not
 * save; the buttons stay visible while there is uncommitted input. While nothing is being edited (not
 * focused, no uncommitted change) it follows a value changed elsewhere.
 */
export const RichTextEditor: PropertyEditorComponent = ({
  value,
  options,
  onCommit,
  onChange,
  subject,
  nodeAddress,
  autoFocus,
}: PropertyEditorProps) => {
  const formatting = useMemo<Formatting>(() => {
    const raw = options as RawFormattingConfig
    if (raw.formatting === undefined && raw.autoparagraph === undefined) {
      return DEFAULT_FORMATTING
    }
    return normalizeFormatting(raw)
  }, [options])

  // Plugin extensions are part of the schema: a registration (a plugin
  // loading after the editor mounted) rebuilds the editor below.
  const extensionDefinitions = useRegistry(richTextExtensionRegistry)

  const containerRef = useRef<HTMLDivElement>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  // Re-render the toolbar on every editor state change (active marks, block).
  const [, refresh] = useReducer((tick: number) => tick + 1, 0)

  // The latest callbacks, readable from editor event handlers without
  // recreating the editor when the inspector re-renders.
  const callbacks = useLatestRef({ onCommit, onChange })
  // The committed baseline, captured after TipTap normalizes the markup so a
  // commit without a real edit never reports a spurious change.
  const committedHtml = useRef('')
  // Set while a toolbar popup (the block format select) holds the focus: the
  // editor blurs, but the edit is still in progress - the value prop is not
  // followed then.
  const holdFocus = useRef(false)
  // Whether the content differs from the committed baseline - drives the
  // inline apply / revert buttons. Kept from the editor's events (updates
  // and commits), as the baseline lives in a ref render must not read.
  const [dirty, setDirty] = useState(false)

  // Commits the content if it differs from the committed baseline.
  const commitPending = useCallback(
    (instance: Editor) => {
      const html = serializedHtml(instance, formatting)
      if (html === committedHtml.current) return
      committedHtml.current = html
      setDirty(false)
      callbacks.current.onCommit(html)
    },
    [formatting, callbacks],
  )

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const editorOptions: RichTextEditorOptions = {
      element,
      content: typeof value === 'string' ? value : '',
      editorProps: {
        handleKeyDown: (_view, event) => {
          if (event.key === 'Escape') {
            instance.commands.setContent(committedHtml.current)
            return true
          }
          // Enter alone starts a new paragraph; mod+Enter commits.
          if (isApplyChord(event)) {
            commitPending(instance)
            return true
          }
          return false
        },
      },
      onCreate: ({ editor }) => {
        committedHtml.current = serializedHtml(editor, formatting)
        setDirty(false)
      },
      onUpdate: ({ editor }) => {
        const html = serializedHtml(editor, formatting)
        setDirty(html !== committedHtml.current)
        callbacks.current.onChange?.(html)
        refresh()
      },
      onSelectionUpdate: refresh,
      onFocus: refresh,
      onBlur: refresh,
    }
    const instance = createRichTextEditor(
      editorOptions,
      formatting,
      'inspector',
    )
    if (autoFocus) instance.commands.focus('end')
    setEditor(instance)
    return () => {
      instance.destroy()
      setEditor(null)
    }
    // Only a changed schema - the formatting config or the registered plugin
    // extensions - warrants recreating the editor (commitPending and
    // callbacks change with it or never): the value prop is followed by the
    // effect below, and autoFocus only matters when the editor is created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatting, extensionDefinitions, commitPending, callbacks])

  // Follow a value changed elsewhere (a collaborator, an inline edit in the
  // preview) - unless it is being edited: focused, or with uncommitted input.
  useEffect(() => {
    if (!editor || editor.isFocused || holdFocus.current) return
    if (serializedHtml(editor, formatting) !== committedHtml.current) return
    editor.commands.setContent(typeof value === 'string' ? value : '', {
      emitUpdate: false,
    })
    committedHtml.current = serializedHtml(editor, formatting)
    refresh()
  }, [editor, value, formatting])

  const apply = () => editor && commitPending(editor)
  const revert = () => editor?.commands.setContent(committedHtml.current)
  useUnsavedDraft(
    dirty,
    nodeAddress !== undefined
      ? { label: subject.label, apply, discard: revert }
      : null,
  )

  const placeholder = plainEditorOption(options, 'placeholder')
  const isEmpty = editor?.isEmpty ?? true

  return (
    <div className="rounded-md border border-border bg-input/30 shadow-xs transition-[color,box-shadow] focus-within:border-primary">
      {editor && (
        <Toolbar
          editor={editor}
          formatting={formatting}
          subject={subject.label}
          onHoldFocus={(hold) => {
            holdFocus.current = hold
          }}
        />
      )}
      <DraftField
        placement="bottom"
        dirty={dirty}
        actions={nodeAddress !== undefined}
        onApply={apply}
        onRevert={revert}
      >
        {placeholder && isEmpty && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-2 left-3 type-body text-muted-foreground"
          >
            {placeholder}
          </span>
        )}
        <div
          ref={containerRef}
          data-draft-target=""
          className={cn(
            'px-3 py-2 type-body',
            // With the buttons, their strip (pb-8) is part of the minimum
            // height - the field is as tall as without them.
            nodeAddress !== undefined
              ? '[&_.tiptap]:min-h-12.5'
              : '[&_.tiptap]:min-h-18.5',
            '[&_.tiptap]:outline-none',
            // Tailwind's preflight strips list and heading styling; restore a
            // compact editing rendition scoped to the editor content.
            '[&_.tiptap_h1]:type-default [&_.tiptap_h1]:font-bold',
            '[&_.tiptap_h2]:type-default [&_.tiptap_h2]:font-bold',
            '[&_.tiptap_h3]:type-default [&_.tiptap_h3]:font-bold',
            '[&_.tiptap_:is(h4,h5,h6)]:font-bold',
            '[&_.tiptap_ul]:list-disc [&_.tiptap_ol]:list-decimal',
            '[&_.tiptap_:is(ul,ol)]:pl-4.5',
            '[&_.tiptap_blockquote]:border-l-2 [&_.tiptap_blockquote]:border-border [&_.tiptap_blockquote]:pl-3 [&_.tiptap_blockquote]:text-muted-foreground',
            '[&_.tiptap_pre]:rounded [&_.tiptap_pre]:bg-muted [&_.tiptap_pre]:p-2 [&_.tiptap_pre]:font-mono [&_.tiptap_pre]:type-small',
            '[&_.tiptap_hr]:my-2 [&_.tiptap_hr]:border-border',
            '[&_.tiptap_a]:text-primary-text [&_.tiptap_a]:underline',
            '[&_.tiptap_p+p]:mt-2',
          )}
        />
      </DraftField>
    </div>
  )
}

/**
 * One toolbar toggle. Mousedown is always prevented so the editor never loses
 * focus (and the selection survives); the action itself runs on mousedown by
 * default. Actions that open a modal must run on click instead
 * (`runOnClick`): opened during mousedown, the dialog would swallow the
 * in-flight mouseup as an outside press and dismiss itself immediately.
 */
function ToolbarButton({
  label,
  active,
  disabled,
  onRun,
  runOnClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onRun: () => void
  runOnClick?: boolean
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={cn(active && 'bg-muted text-primary-text')}
      onMouseDown={(event) => {
        event.preventDefault()
        if (!runOnClick) onRun()
      }}
      onClick={() => {
        if (runOnClick) onRun()
      }}
    >
      {children}
    </Button>
  )
}

/** The current top-level block at the selection, as a block-select value. */
function activeBlock(editor: Editor, formatting: Formatting): string {
  for (const level of formatting.headingLevels) {
    if (editor.isActive('heading', { level })) return `h${level}`
  }
  if (formatting.codeBlock && editor.isActive('codeBlock')) return 'pre'
  return 'p'
}

function Toolbar({
  editor,
  formatting,
  subject,
  onHoldFocus,
}: {
  editor: Editor
  formatting: Formatting
  subject: string
  /** Called with true while the block format popup is open - the editor is still being edited. */
  onHoldFocus: (hold: boolean) => void
}) {
  // The link being edited while the dialog is open, with the selection to
  // apply it to (opening the dialog blurs the editor; the range survives).
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [linkEdit, setLinkEdit] = useState<{
    value: LinkValue | null
    from: number
    to: number
  } | null>(null)

  const chain = () => editor.chain().focus()

  const openLinkDialog = () => {
    if (editor.isActive('link')) {
      editor.chain().extendMarkRange('link').run()
    }
    const { from, to } = editor.state.selection
    if (from === to && !editor.isActive('link')) return
    const attrs = editor.getAttributes('link')
    const str = (v: unknown): string | null =>
      typeof v === 'string' && v !== '' ? v : null
    setLinkEdit({
      from,
      to,
      value:
        typeof attrs.href === 'string' && attrs.href !== ''
          ? {
              href: attrs.href,
              target: str(attrs.target),
              rel: str(attrs.rel),
              cssClass: str(attrs.class),
              title: str(attrs.title),
            }
          : null,
    })
  }

  const applyLink = (value: LinkValue | null) => {
    if (!linkEdit) return
    const range = editor
      .chain()
      .focus()
      .setTextSelection({ from: linkEdit.from, to: linkEdit.to })
      .extendMarkRange('link')
    if (value === null) {
      range.unsetLink().run()
    } else {
      range.setLink(linkAttributesFrom(value)).run()
    }
    setLinkEdit(null)
  }

  // The NodeType's style definitions that apply where the selection is. Block
  // and inline styles share one dropdown here (as CKEditor does), since the
  // inspector has a single persistent toolbar rather than the preview's split
  // block/inline bars. No previews: the inspector renders in the host
  // document, which has none of the site's CSS to preview them with - the
  // element each style produces is named instead.
  const availableStyles: ResolvedStyle[] = formatting.styles.filter((style) =>
    isStyleAvailable(editor, style),
  )

  const blockChoices = [
    ...(formatting.paragraph
      ? [{ value: 'p', label: t('editor.rte.paragraph', 'Paragraph') }]
      : []),
    ...formatting.headingLevels.map((level) => ({
      value: `h${level}`,
      label: t('editor.rte.heading', 'Heading {0}', [level]),
    })),
    ...(formatting.codeBlock
      ? [{ value: 'pre', label: t('editor.rte.codeBlock', 'Code block') }]
      : []),
  ]

  return (
    <div
      ref={toolbarRef}
      className="flex flex-wrap items-center gap-0.5 border-b border-border p-1"
    >
      {formatting.block && blockChoices.length > 1 && (
        <Select
          items={blockChoices}
          value={activeBlock(editor, formatting)}
          // The popup takes the focus from the editor while open, which is
          // part of the edit: the focus goes back into the editor afterwards
          // - unless the popup was left for another control.
          onOpenChange={(open) => {
            onHoldFocus(open)
            if (open) return
            setTimeout(() => {
              if (editor.isDestroyed || editor.isFocused) return
              const active = document.activeElement
              if (
                active === null ||
                active === document.body ||
                toolbarRef.current?.contains(active)
              ) {
                editor.commands.focus()
              }
            })
          }}
          onValueChange={(value) => {
            const block = String(value)
            if (block === 'p') chain().setParagraph().run()
            else if (block === 'pre') chain().setCodeBlock().run()
            else if (block.startsWith('h')) {
              chain()
                .setHeading({
                  level: Number(block.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6,
                })
                .run()
            }
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label={t('editor.rte.blockFormat', 'Block format')}
            // Opening it must not blur the editor before holdFocus is set.
            onMouseDown={(event) => event.preventDefault()}
            className="h-5.5 w-26 border-none bg-transparent type-small shadow-none"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {blockChoices.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {formatting.bold && (
        <ToolbarButton
          label={t('editor.rte.bold', 'Bold')}
          active={editor.isActive('bold')}
          onRun={() => chain().toggleBold().run()}
        >
          <i className="fas fa-bold type-icon-m" aria-hidden />
        </ToolbarButton>
      )}
      {formatting.italic && (
        <ToolbarButton
          label={t('editor.rte.italic', 'Italic')}
          active={editor.isActive('italic')}
          onRun={() => chain().toggleItalic().run()}
        >
          <i className="fas fa-italic type-icon-m" aria-hidden />
        </ToolbarButton>
      )}
      {formatting.underline && (
        <ToolbarButton
          label={t('editor.rte.underline', 'Underline')}
          active={editor.isActive('underline')}
          onRun={() => chain().toggleUnderline().run()}
        >
          <i className="fas fa-underline type-icon-m" aria-hidden />
        </ToolbarButton>
      )}
      {formatting.strike && (
        <ToolbarButton
          label={t('editor.rte.strikethrough', 'Strikethrough')}
          active={editor.isActive('strike')}
          onRun={() => chain().toggleStrike().run()}
        >
          <i className="fas fa-strikethrough type-icon-m" aria-hidden />
        </ToolbarButton>
      )}
      {formatting.code && (
        <ToolbarButton
          label={t('editor.rte.code', 'Code')}
          active={editor.isActive('code')}
          onRun={() => chain().toggleCode().run()}
        >
          <i className="fas fa-code type-icon-m" aria-hidden />
        </ToolbarButton>
      )}
      {formatting.subscript && (
        <ToolbarButton
          label={t('editor.rte.subscript', 'Subscript')}
          active={editor.isActive('subscript')}
          onRun={() => chain().toggleSubscript().run()}
        >
          <i className="fas fa-subscript type-icon-m" aria-hidden />
        </ToolbarButton>
      )}
      {formatting.superscript && (
        <ToolbarButton
          label={t('editor.rte.superscript', 'Superscript')}
          active={editor.isActive('superscript')}
          onRun={() => chain().toggleSuperscript().run()}
        >
          <i className="fas fa-superscript type-icon-m" aria-hidden />
        </ToolbarButton>
      )}
      {formatting.link && (
        <ToolbarButton
          label={t('editor.rte.link', 'Link')}
          active={editor.isActive('link')}
          onRun={openLinkDialog}
          runOnClick
        >
          <i className="fas fa-link type-icon-m" aria-hidden />
        </ToolbarButton>
      )}
      {formatting.bulletList && (
        <ToolbarButton
          label={t('editor.rte.bulletList', 'Bullet list')}
          active={editor.isActive('bulletList')}
          onRun={() => chain().toggleBulletList().run()}
        >
          <i className="fas fa-list type-icon-m" aria-hidden />
        </ToolbarButton>
      )}
      {formatting.orderedList && (
        <ToolbarButton
          label={t('editor.rte.orderedList', 'Ordered list')}
          active={editor.isActive('orderedList')}
          onRun={() => chain().toggleOrderedList().run()}
        >
          <i className="fas fa-list-ol type-icon-m" aria-hidden />
        </ToolbarButton>
      )}
      {formatting.blockquote && (
        <ToolbarButton
          label={t('editor.rte.blockquote', 'Blockquote')}
          active={editor.isActive('blockquote')}
          onRun={() => chain().toggleBlockquote().run()}
        >
          <i className="fas fa-quote-left type-icon-m" aria-hidden />
        </ToolbarButton>
      )}
      {formatting.horizontalRule && formatting.multiline && (
        <ToolbarButton
          label={t('editor.rte.horizontalRule', 'Horizontal rule')}
          onRun={() => chain().setHorizontalRule().run()}
        >
          <i className="fas fa-minus type-icon-m" aria-hidden />
        </ToolbarButton>
      )}
      {formatting.removeFormat && (
        <ToolbarButton
          label={t('editor.rte.removeFormat', 'Remove formatting')}
          onRun={() => chain().unsetAllMarks().run()}
        >
          <i className="fas fa-eraser type-icon-m" aria-hidden />
        </ToolbarButton>
      )}
      {activeRichTextExtensions(editor).flatMap((definition) =>
        (definition.toolbar ?? []).map((item) => (
          <ToolbarButton
            key={`${definition.id}:${item.id}`}
            label={item.label}
            active={guardedToolbarCall(
              definition,
              item,
              () => item.isActive?.(editor) ?? false,
              false,
            )}
            disabled={guardedToolbarCall(
              definition,
              item,
              () => item.isDisabled?.(editor) ?? false,
              false,
            )}
            onRun={() =>
              guardedToolbarCall(
                definition,
                item,
                () => item.run(editor),
                undefined,
              )
            }
          >
            <i
              className={cn(faClassName(item.icon), 'type-icon-m')}
              aria-hidden
            />
          </ToolbarButton>
        )),
      )}
      {availableStyles.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                title={t('editor.rte.styles', 'Styles')}
                aria-label={t('editor.rte.styles', 'Styles')}
              />
            }
          >
            <i className="fas fa-paintbrush type-icon-m" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {availableStyles.map((style) => {
              const active = isStyleActive(editor, style)
              return (
                <DropdownMenuItem
                  key={style.name}
                  onClick={() => toggleStyle(editor, style)}
                >
                  <i
                    className={cn(
                      'fas fa-check type-icon-s',
                      !active && 'invisible',
                    )}
                    aria-hidden
                  />
                  {style.name}
                  <span className="ml-auto pl-2 type-code-small text-muted-foreground">
                    {`<${style.element}>`}
                  </span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {linkEdit && (
        <LinkEditorDialog
          open
          onOpenChange={(open) => {
            if (!open) setLinkEdit(null)
          }}
          subject={subject}
          value={linkEdit.value}
          withOptions
          onApply={applyLink}
          onRemove={linkEdit.value ? () => applyLink(null) : undefined}
        />
      )}
    </div>
  )
}
