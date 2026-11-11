import { useState } from 'react'
import { generateUriPathSegment, useNode } from '@/api/neos/endpoints/nodes'
import { Button } from '@/components/ui/button'
import { DraftField } from '@/components/ui/draft-field'
import { Input } from '@/components/ui/input'
import { useUnsavedDraft } from '@/features/inspector/unsavedChanges'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'
import type { PropertyEditorComponent } from './registry'

export const URI_PATH_SEGMENT_EDITOR =
  'Neos.Neos/Inspector/Editors/UriPathSegmentEditor'

/**
 * The document's URL path segment (slug), with the classic UI's "sync" button
 * next to it: it rebuilds the segment from the current page title, running the
 * same server-side, language-aware transliteration (see generateUriPathSegment)
 * so the result matches what the old UI produced. Like the plain text editor it
 * holds a local draft, reports it live through onChange and commits on Enter
 * or the inline apply button (Escape or the revert button reverts; leaving
 * the field does not save); syncing writes the generated value straight into
 * the draft and commits it, so the field reflects it before the save
 * round-trips. As there, the draft follows the incoming value
 * while there is no unsaved edit, and only a draft that differs from the value
 * the edit started from commits.
 *
 * The sync button needs an existing node to read the title from and to resolve
 * the language dimension, so it only appears in the inspector (where a
 * nodeAddress is present), not in the creation dialog.
 */
export const UriPathSegmentEditor: PropertyEditorComponent = ({
  id,
  subject,
  value,
  onCommit,
  onChange,
  nodeAddress,
  autoFocus,
  invalid,
}) => {
  const initial = value === null || value === undefined ? '' : String(value)
  const [draft, setDraft] = useState(initial)
  // The value the current draft started from.
  const [base, setBase] = useState(initial)
  if (initial !== base && (draft === base || draft === initial)) {
    setBase(initial)
    setDraft(initial)
  }
  // The draft last handed to onCommit - see textEditorBody.
  const [submitted, setSubmitted] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)

  // Read from cache (the inspector already fetched this node) to feed the
  // current title into slug generation - the classic UI's
  // ClientEval:node.properties.title.
  const { data: self } = useNode(nodeAddress ?? null)

  const dirty = draft !== base && draft !== submitted
  const commit = () => {
    if (!dirty) return
    setSubmitted(draft)
    onCommit(draft)
  }
  const revert = () => {
    setBase(initial)
    setDraft(initial)
    setSubmitted(null)
    onChange?.(initial)
  }

  useUnsavedDraft(
    dirty,
    nodeAddress !== undefined
      ? { label: subject.label, apply: commit, discard: revert }
      : null,
  )

  const sync = async () => {
    if (!nodeAddress) return
    const title = self?.properties.title
    setIsSyncing(true)
    try {
      const slug = await generateUriPathSegment(
        nodeAddress,
        typeof title === 'string' ? title : '',
      )
      setDraft(slug)
      onChange?.(slug)
      if (slug !== initial) {
        setSubmitted(slug)
        onCommit(slug)
      }
    } catch (error) {
      toast.error(error, {
        title: t(
          'editor.uriPathSegment.generateFailed',
          'Could not generate the URL path segment',
        ),
      })
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <DraftField
        className="min-w-0 flex-1"
        dirty={dirty}
        actions={nodeAddress !== undefined}
        onApply={commit}
        onRevert={revert}
      >
        <Input
          id={id}
          data-draft-target=""
          autoFocus={autoFocus}
          value={draft}
          aria-invalid={invalid || undefined}
          disabled={isSyncing}
          onChange={(event) => {
            setDraft(event.target.value)
            onChange?.(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              revert()
            }
            if (event.key === 'Enter') commit()
          }}
        />
      </DraftField>
      {nodeAddress && (
        <Button
          variant="secondary"
          size="icon"
          disabled={isSyncing}
          onClick={sync}
          title={t(
            'editor.uriPathSegment.rebuild',
            'Rebuild the URL path segment from the current page title',
          )}
        >
          <i
            className={`fas fa-fw fa-rotate ${isSyncing ? 'fa-spin' : ''}`}
            aria-hidden
          />
        </Button>
      )}
    </div>
  )
}
