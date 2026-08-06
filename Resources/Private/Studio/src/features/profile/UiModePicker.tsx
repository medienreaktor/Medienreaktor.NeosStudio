import { useRef } from 'react'

import { cn } from '@/lib/utils'
import { translate as t } from '@/lib/i18n'
import type { UiMode } from '@/lib/uiMode'

/**
 * macOS-style appearance picker: one thumbnail tile per UI mode showing a
 * miniature window mockup in that mode, the system tile split half/half.
 * The selected tile carries a blue ring, the label below turns bold.
 *
 * The thumbnails depict a fixed appearance, so their colors deliberately do
 * NOT follow the app theme (a "Light" tile must look light in a dark app) -
 * this is one of the few places raw single-mode colors are correct.
 */
export function UiModePicker({
  value,
  onChange,
}: {
  value: UiMode
  onChange: (mode: UiMode) => void
}) {
  const groupRef = useRef<HTMLDivElement>(null)

  // Same order as the macOS appearance setting: automatic first.
  const options: { mode: UiMode; label: string }[] = [
    { mode: 'system', label: t('profile.uiModeSystem', 'System') },
    { mode: 'light', label: t('profile.uiModeLight', 'Light') },
    { mode: 'dark', label: t('profile.uiModeDark', 'Dark') },
  ]

  // Roving radio-group keyboard support: arrows move + select.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    if (delta === 0) return
    event.preventDefault()
    const index = options.findIndex((option) => option.mode === value)
    const next = options[(index + delta + options.length) % options.length]
    onChange(next.mode)
    groupRef.current
      ?.querySelector<HTMLButtonElement>(`[data-mode="${next.mode}"]`)
      ?.focus()
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={t('profile.uiMode', 'Appearance')}
      className="flex gap-4"
      onKeyDown={onKeyDown}
    >
      {options.map(({ mode, label }) => {
        const selected = mode === value
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={selected}
            data-mode={mode}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(mode)}
            className="group flex w-fit cursor-pointer flex-col items-center gap-1.5 outline-none"
          >
            <span
              className={cn(
                'rounded-lg border-2 p-0.5 transition-colors',
                selected
                  ? 'border-blue-500'
                  : 'border-transparent group-hover:border-neutral-300 dark:group-hover:border-neutral-700',
                'group-focus-visible:ring-2 group-focus-visible:ring-blue-500/50',
              )}
            >
              <ModeThumbnail mode={mode} />
            </span>
            <span
              className={cn(
                'text-xs',
                selected
                  ? 'font-semibold text-neutral-950 dark:text-white'
                  : 'text-neutral-600 dark:text-neutral-400',
              )}
            >
              {label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** The miniature window mockup; `system` overlays dark on the right half. */
function ModeThumbnail({ mode }: { mode: UiMode }) {
  if (mode === 'system') {
    return (
      <span className="relative block">
        <HalfThumbnail appearance="light" />
        <span
          className="absolute inset-0"
          style={{ clipPath: 'inset(0 0 0 50%)' }}
        >
          <HalfThumbnail appearance="dark" />
        </span>
      </span>
    )
  }
  return <HalfThumbnail appearance={mode} />
}

function HalfThumbnail({ appearance }: { appearance: 'light' | 'dark' }) {
  const dark = appearance === 'dark'
  return (
    <span
      className={cn(
        'relative block h-16 w-24 overflow-hidden rounded-md',
        // "Wallpaper" behind the mini UI - a blue sweep echoing the brand.
        dark
          ? 'bg-gradient-to-br from-blue-950 via-blue-900 to-purple-950'
          : 'bg-gradient-to-br from-blue-200 via-blue-300 to-blue-400',
      )}
      aria-hidden
    >
      {/* Menu bar */}
      <span
        className={cn(
          'absolute inset-x-0 top-0 block h-2',
          dark ? 'bg-neutral-800/90' : 'bg-white/80',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-1 block size-1 rounded-full',
            dark ? 'bg-neutral-500' : 'bg-neutral-400',
          )}
        />
      </span>
      {/* Selection pill */}
      <span className="absolute top-3.5 left-2 block h-2 w-14 rounded-[3px] border border-white/40 bg-blue-500" />
      {/* Window with traffic lights */}
      <span
        className={cn(
          'absolute -bottom-1 left-4 block h-6 w-16 rounded-t-md',
          dark ? 'bg-neutral-900' : 'bg-white',
        )}
      >
        <span className="absolute top-1.5 left-1.5 flex gap-1">
          <span className="size-1.5 rounded-full bg-red-400" />
          <span className="size-1.5 rounded-full bg-orange-300" />
          <span className="size-1.5 rounded-full bg-green-400" />
        </span>
      </span>
    </span>
  )
}
