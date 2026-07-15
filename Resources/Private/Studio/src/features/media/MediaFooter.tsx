import { LayoutGridIcon, ListIcon, UploadIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MediaBrowserController } from './useMediaBrowserState'

/**
 * The Media Library footer: Upload on the left, the count of assets in the
 * current selection centred, and the grid/list display toggle on the right.
 */
export function MediaFooter({
  state,
  total,
  onUpload,
}: {
  state: MediaBrowserController
  total: number | undefined
  onUpload: () => void
}) {
  return (
    <div className="flex items-center gap-2 border-t border-neutral-800 bg-neutral-900 px-3 py-2">
      <Button size="sm" onClick={onUpload}>
        <UploadIcon className="size-4" />
        Upload
      </Button>

      <span className="flex-1 text-center text-xs text-neutral-500">
        {total !== undefined && `${total} asset${total === 1 ? '' : 's'}`}
      </span>

      <div className="flex rounded-md border border-neutral-700">
        <ViewToggle
          active={state.view === 'grid'}
          onClick={() => state.setView('grid')}
          label="Grid view"
        >
          <LayoutGridIcon className="size-4" />
        </ViewToggle>
        <ViewToggle
          active={state.view === 'list'}
          onClick={() => state.setView('list')}
          label="List view"
        >
          <ListIcon className="size-4" />
        </ViewToggle>
      </div>
    </div>
  )
}

function ViewToggle({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'grid size-8 place-items-center first:rounded-l-md last:rounded-r-md',
        active
          ? 'bg-neutral-700 text-white'
          : 'text-neutral-400 hover:bg-neutral-800',
      )}
    >
      {children}
    </button>
  )
}
