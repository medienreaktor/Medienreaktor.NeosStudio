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
      className="flex gap-3.5"
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
                  ? 'border-primary'
                  : 'border-transparent group-hover:border-border',
                'group-focus-visible:ring-2 group-focus-visible:ring-ring/50',
              )}
            >
              <ModeThumbnail mode={mode} />
            </span>
            <span
              className={cn(
                'type-small-strong',
                selected
                  ? 'font-semibold text-foreground'
                  : 'text-muted-foreground',
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
  // A themed island: data-theme switches the semantic tokens for everything
  // inside, so the miniature is drawn with the real light / dark values.
  return (
    <span data-theme={appearance} className="block" aria-hidden>
      <span
        className={cn(
          'relative block h-15 w-22.5 overflow-hidden rounded-md bg-background',
          // "Wallpaper" behind the mini UI - a blue sweep echoing the brand.
          'bg-gradient-to-br from-primary/30 via-primary/50 to-variant/50',
        )}
      >
        {/* Menu bar */}
        <span className="absolute inset-x-0 top-0 block h-2 bg-card/80">
          <span className="absolute top-0.5 left-1 block size-1 rounded-full bg-placeholder" />
        </span>
        {/* Selection pill */}
        <span className="absolute top-3.5 left-2 block h-2 w-13 rounded-[3px] border border-scrim-foreground/40 bg-primary" />
        {/* Window with traffic lights */}
        <span className="absolute -bottom-1 left-3.5 block h-5.5 w-15 rounded-t-md bg-background">
          <span className="absolute top-1.5 left-1.5 flex gap-1">
            <span className="size-1.5 rounded-full bg-destructive" />
            <span className="size-1.5 rounded-full bg-warning" />
            <span className="size-1.5 rounded-full bg-success" />
          </span>
        </span>
      </span>
    </span>
  )
}
