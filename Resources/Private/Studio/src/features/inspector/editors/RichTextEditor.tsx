import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Editor } from '@tiptap/core'
import {
  BoldIcon,
  CodeIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  RemoveFormattingIcon,
  StrikethroughIcon,
  SubscriptIcon,
  SuperscriptIcon,
  TextQuoteIcon,
  UnderlineIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { plainEditorOption } from '@/features/inspector/inspectorSchema'
import { LinkEditorDialog } from '@/features/links/LinkEditorDialog'
import { linkAttributesFrom, type LinkValue } from '@/features/links/linkValue'
import {
  DEFAULT_FORMATTING,
  extensionsFor,
  normalizeFormatting,
  type Formatting,
  type RawFormattingConfig,
} from '@/guest/formatting'
import { cn } from '@/lib/utils'
import type { PropertyEditorComponent, PropertyEditorProps } from './registry'

export const RICH_TEXT_EDITOR = 'Neos.Neos/Inspector/Editors/RichTextEditor'

/**
 * The inspector's rich text editor: the same TipTap engine that powers inline
 * editing in the preview (same schema mapping, so a property permits exactly
 * what its NodeType's `formatting` flags declare), mounted as an inspector
 * field with a persistent toolbar. Commits getHTML() on blur like the inline
 * editors; Escape reverts to the last committed markup.
 */
export const RichTextEditor: PropertyEditorComponent = ({
  value,
  options,
  onCommit,
  onChange,
  subject,
  autoFocus,
}: PropertyEditorProps) => {
  const formatting = useMemo<Formatting>(() => {
    const raw = options as RawFormattingConfig
    if (raw.formatting === undefined && raw.autoparagraph === undefined) {
      return DEFAULT_FORMATTING
    }
    return normalizeFormatting(raw)
  }, [options])

  const containerRef = useRef<HTMLDivElement>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  // Re-render the toolbar on every editor state change (active marks, block).
  const [, refresh] = useReducer((tick: number) => tick + 1, 0)

  // The latest callbacks, readable from editor event handlers without
  // recreating the editor when the inspector re-renders.
  const callbacks = useRef({ onCommit, onChange })
  callbacks.current = { onCommit, onChange }

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    // The committed baseline, captured after TipTap normalizes the markup so
    // a blur without a real edit never reports a spurious change.
    let committedHtml = ''
    const instance = new Editor({
      element,
      content: typeof value === 'string' ? value : '',
      extensions: extensionsFor(formatting),
      editorProps: {
        handleKeyDown: (_view, event) => {
          if (event.key === 'Escape') {
            instance.commands.setContent(committedHtml)
            instance.commands.blur()
            return true
          }
          return false
        },
      },
      onCreate: ({ editor }) => {
        committedHtml = editor.getHTML()
      },
      onUpdate: ({ editor }) => {
        callbacks.current.onChange?.(editor.getHTML())
        refresh()
      },
      onSelectionUpdate: refresh,
      onFocus: refresh,
      onBlur: ({ editor }) => {
        refresh()
        const html = editor.getHTML()
        if (html === committedHtml) return
        committedHtml = html
        callbacks.current.onCommit(html)
      },
    })
    if (autoFocus) instance.commands.focus('end')
    setEditor(instance)
    return () => {
      instance.destroy()
      setEditor(null)
    }
    // The value prop only seeds the content (the host remounts on subject
    // change); only a changed schema warrants recreating the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatting])

  const placeholder = plainEditorOption(options, 'placeholder')
  const isEmpty = editor?.isEmpty ?? true

  return (
    <div className="rounded-md border border-neutral-700 shadow-xs transition-[color,box-shadow] focus-within:border-blue-500 dark:bg-neutral-700/30">
      {editor && (
        <Toolbar
          editor={editor}
          formatting={formatting}
          subject={subject.label}
        />
      )}
      <div className="relative">
        {placeholder && isEmpty && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-2 left-3 text-sm text-neutral-400"
          >
            {placeholder}
          </span>
        )}
        <div
          ref={containerRef}
          className={cn(
            'px-3 py-2 text-sm',
            '[&_.tiptap]:min-h-20 [&_.tiptap]:outline-none',
            // Tailwind's preflight strips list and heading styling; restore a
            // compact editing rendition scoped to the editor content.
            '[&_.tiptap_h1]:text-xl [&_.tiptap_h1]:font-bold',
            '[&_.tiptap_h2]:text-lg [&_.tiptap_h2]:font-bold',
            '[&_.tiptap_h3]:text-base [&_.tiptap_h3]:font-bold',
            '[&_.tiptap_:is(h4,h5,h6)]:font-bold',
            '[&_.tiptap_ul]:list-disc [&_.tiptap_ol]:list-decimal',
            '[&_.tiptap_:is(ul,ol)]:pl-5',
            '[&_.tiptap_blockquote]:border-l-2 [&_.tiptap_blockquote]:border-neutral-700 [&_.tiptap_blockquote]:pl-3 [&_.tiptap_blockquote]:text-neutral-400',
            '[&_.tiptap_pre]:rounded [&_.tiptap_pre]:bg-neutral-800 [&_.tiptap_pre]:p-2 [&_.tiptap_pre]:font-mono [&_.tiptap_pre]:text-xs',
            '[&_.tiptap_hr]:my-2 [&_.tiptap_hr]:border-neutral-700',
            '[&_.tiptap_a]:text-blue-500 [&_.tiptap_a]:underline',
            '[&_.tiptap_p+p]:mt-2',
          )}
        />
      </div>
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
      className={cn(active && 'bg-neutral-800 text-blue-500')}
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
}: {
  editor: Editor
  formatting: Formatting
  subject: string
}) {
  // The link being edited while the dialog is open, with the selection to
  // apply it to (opening the dialog blurs the editor; the range survives).
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

  const blockChoices = [
    ...(formatting.paragraph ? [{ value: 'p', label: 'Paragraph' }] : []),
    ...formatting.headingLevels.map((level) => ({
      value: `h${level}`,
      label: `Heading ${level}`,
    })),
    ...(formatting.codeBlock ? [{ value: 'pre', label: 'Code block' }] : []),
  ]

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-neutral-700 p-1">
      {formatting.block && blockChoices.length > 1 && (
        <Select
          value={activeBlock(editor, formatting)}
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
            aria-label="Block format"
            className="h-6 w-28 border-none bg-transparent text-xs shadow-none dark:bg-transparent"
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
          label="Bold"
          active={editor.isActive('bold')}
          onRun={() => chain().toggleBold().run()}
        >
          <BoldIcon />
        </ToolbarButton>
      )}
      {formatting.italic && (
        <ToolbarButton
          label="Italic"
          active={editor.isActive('italic')}
          onRun={() => chain().toggleItalic().run()}
        >
          <ItalicIcon />
        </ToolbarButton>
      )}
      {formatting.underline && (
        <ToolbarButton
          label="Underline"
          active={editor.isActive('underline')}
          onRun={() => chain().toggleUnderline().run()}
        >
          <UnderlineIcon />
        </ToolbarButton>
      )}
      {formatting.strike && (
        <ToolbarButton
          label="Strikethrough"
          active={editor.isActive('strike')}
          onRun={() => chain().toggleStrike().run()}
        >
          <StrikethroughIcon />
        </ToolbarButton>
      )}
      {formatting.code && (
        <ToolbarButton
          label="Code"
          active={editor.isActive('code')}
          onRun={() => chain().toggleCode().run()}
        >
          <CodeIcon />
        </ToolbarButton>
      )}
      {formatting.subscript && (
        <ToolbarButton
          label="Subscript"
          active={editor.isActive('subscript')}
          onRun={() => chain().toggleSubscript().run()}
        >
          <SubscriptIcon />
        </ToolbarButton>
      )}
      {formatting.superscript && (
        <ToolbarButton
          label="Superscript"
          active={editor.isActive('superscript')}
          onRun={() => chain().toggleSuperscript().run()}
        >
          <SuperscriptIcon />
        </ToolbarButton>
      )}
      {formatting.link && (
        <ToolbarButton
          label="Link"
          active={editor.isActive('link')}
          onRun={openLinkDialog}
          runOnClick
        >
          <LinkIcon />
        </ToolbarButton>
      )}
      {formatting.bulletList && (
        <ToolbarButton
          label="Bullet list"
          active={editor.isActive('bulletList')}
          onRun={() => chain().toggleBulletList().run()}
        >
          <ListIcon />
        </ToolbarButton>
      )}
      {formatting.orderedList && (
        <ToolbarButton
          label="Ordered list"
          active={editor.isActive('orderedList')}
          onRun={() => chain().toggleOrderedList().run()}
        >
          <ListOrderedIcon />
        </ToolbarButton>
      )}
      {formatting.blockquote && (
        <ToolbarButton
          label="Blockquote"
          active={editor.isActive('blockquote')}
          onRun={() => chain().toggleBlockquote().run()}
        >
          <TextQuoteIcon />
        </ToolbarButton>
      )}
      {formatting.horizontalRule && formatting.multiline && (
        <ToolbarButton
          label="Horizontal rule"
          onRun={() => chain().setHorizontalRule().run()}
        >
          <MinusIcon />
        </ToolbarButton>
      )}
      {formatting.removeFormat && (
        <ToolbarButton
          label="Remove formatting"
          onRun={() => chain().unsetAllMarks().run()}
        >
          <RemoveFormattingIcon />
        </ToolbarButton>
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
