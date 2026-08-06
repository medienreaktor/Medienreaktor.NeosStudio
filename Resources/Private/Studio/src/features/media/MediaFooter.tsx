import { Button } from '@/components/ui/button'
import { translate as t } from '@/lib/i18n'
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
    <div className="flex items-center gap-2 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 px-3 py-2">
      <Button size="sm" onClick={onUpload}>
        <i className="fas fa-upload text-[1rem]" aria-hidden />
        {t('media.upload', 'Upload')}
      </Button>

      <span className="flex-1 text-center text-xs text-neutral-500">
        {total !== undefined &&
          (total === 1
            ? t('media.assetCountOne', '{0} asset', [total])
            : t('media.assetCountOther', '{0} assets', [total]))}
      </span>

      <div className="flex rounded-md border border-neutral-300 dark:border-neutral-700">
        <ViewToggle
          active={state.view === 'grid'}
          onClick={() => state.setView('grid')}
          label={t('media.gridView', 'Grid view')}
        >
          <i className="fas fa-table-cells-large text-[1rem]" aria-hidden />
        </ViewToggle>
        <ViewToggle
          active={state.view === 'list'}
          onClick={() => state.setView('list')}
          label={t('media.listView', 'List view')}
        >
          <i className="fas fa-list text-[1rem]" aria-hidden />
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
          ? 'bg-neutral-300 dark:bg-neutral-700 text-neutral-950 dark:text-white'
          : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800',
      )}
    >
      {children}
    </button>
  )
}
