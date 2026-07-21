import { useNodeTypes } from '@/api/nodeTypes'
import { Button } from '@/components/ui/button'
import { Placeholder } from '@/components/ui/placeholder'
import { NodeTypeIcon } from '@/features/tree/nodeTypeIcon'
import { cn } from '@/lib/utils'
import {
  type ClipboardEntry,
  clipboardActivate,
  clipboardClear,
  clipboardRemove,
  useClipboard,
} from './clipboardStore'

/**
 * The Clipboard panel: the current and historic cut/copy entries, newest
 * first. Exactly one entry is active - the one "Paste into/after" inserts -
 * and clicking an older entry re-activates it, so something copied earlier
 * can be pasted again without re-copying it.
 */
export function ClipboardPanel() {
  const { entries, activeId } = useClipboard()
  const { data: nodeTypes } = useNodeTypes()

  if (entries.length === 0) {
    return (
      <Placeholder
        icon="fa-clipboard"
        title="Nothing on the clipboard. Cut or copy a document or element from its context menu."
      />
    )
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-neutral-400">
          Paste inserts the highlighted entry.
        </span>
        <Button variant="ghost" size="xs" onClick={clipboardClear}>
          Clear
        </Button>
      </div>
      {entries.map((entry) => (
        <ClipboardRow
          key={entry.id}
          entry={entry}
          active={entry.id === activeId}
          nodeTypes={nodeTypes}
        />
      ))}
    </div>
  )
}

function ClipboardRow({
  entry,
  active,
  nodeTypes,
}: {
  entry: ClipboardEntry
  active: boolean
  nodeTypes: ReturnType<typeof useNodeTypes>['data']
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-sm border border-transparent pr-1',
        active ? 'border-blue-500 bg-neutral-800' : 'hover:bg-neutral-800',
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left"
        title={
          active ? undefined : 'Make this the entry the next paste inserts'
        }
        onClick={() => clipboardActivate(entry.id)}
      >
        <span
          className="shrink-0 text-neutral-400"
          title={entry.mode === 'cut' ? 'Cut - pasting moves it' : 'Copied'}
        >
          <i
            className={cn(
              'fas fa-fw text-[0.7rem]',
              entry.mode === 'cut' ? 'fa-scissors' : 'fa-copy',
            )}
            aria-hidden
          />
        </span>
        <span className="shrink-0 text-white">
          <NodeTypeIcon nodeTypes={nodeTypes} nodeTypeName={entry.nodeType} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block overflow-hidden text-sm text-ellipsis whitespace-nowrap">
            {entry.label}
          </span>
          <span className="block text-xs text-neutral-400 capitalize">
            {entry.mode === 'cut' ? 'Cut' : 'Copied'} {entry.kind}
          </span>
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        title="Remove from clipboard"
        onClick={() => clipboardRemove(entry.id)}
      >
        <i className="fas fa-xmark" aria-hidden />
      </Button>
    </div>
  )
}
