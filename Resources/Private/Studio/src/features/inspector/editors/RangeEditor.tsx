import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { plainEditorOption } from '@/features/inspector/inspectorSchema'
import { cn } from '@/lib/utils'
import type { PropertyEditorComponent, PropertyEditorProps } from './registry'

export const RANGE_EDITOR = 'Neos.Neos/Inspector/Editors/RangeEditor'

/**
 * The editorOptions contract of the classic UI's RangeEditor: numeric bounds
 * and step, an optional unit suffix, and optional label overrides for the
 * bound captions under the slider.
 */
interface RangeOptions {
  min: number
  max: number
  step: number
  unit: string
  minLabel: string | undefined
  maxLabel: string | undefined
  disabled: boolean
}

function rangeOptions(options: Record<string, unknown>): RangeOptions {
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return {
    min: num(options.min, 0),
    max: num(options.max, 100),
    step: num(options.step, 1) || 1,
    unit: typeof options.unit === 'string' ? options.unit : '',
    minLabel: plainEditorOption(options, 'minLabel'),
    maxLabel: plainEditorOption(options, 'maxLabel'),
    disabled: options.disabled === true,
  }
}

/**
 * A slider with a numeric input beside it, for bounded numeric properties.
 * The classic UI committed every slider tick; the Studio inspector persists on
 * commit, so dragging only reports live changes (feeding ClientEval) and the
 * value commits when the drag ends (onValueCommitted) or the number input
 * blurs - one save per adjustment instead of one per tick.
 */
export const RangeEditor: PropertyEditorComponent = ({
  value,
  options,
  onCommit,
  onChange,
}: PropertyEditorProps) => {
  const opts = rangeOptions(options)
  const integerStep = opts.step % 1 === 0

  const parse = (raw: string): number | null => {
    const parsed = integerStep ? parseInt(raw, 10) : parseFloat(raw)
    if (Number.isNaN(parsed)) return null
    return Math.min(opts.max, Math.max(opts.min, parsed))
  }

  const initial =
    typeof value === 'number'
      ? Math.min(opts.max, Math.max(opts.min, value))
      : typeof value === 'string' && value !== ''
        ? parse(value)
        : null
  // The draft is a string so the number input can hold in-progress entry
  // ("", "-", "1."); the slider reads it as a number, defaulting to min.
  const [draft, setDraft] = useState(initial === null ? '' : String(initial))
  const [committed, setCommitted] = useState(initial)

  const commitNumber = (next: number) => {
    setDraft(String(next))
    if (next === committed) return
    setCommitted(next)
    onCommit(next)
  }

  const commitDraft = () => {
    const parsed = parse(draft)
    if (parsed === null) {
      // A non-number reverts to the last committed value, like the text editor.
      setDraft(committed === null ? '' : String(committed))
      return
    }
    commitNumber(parsed)
  }

  return (
    <div
      className={cn(
        'flex items-start gap-4',
        opts.disabled && 'pointer-events-none opacity-50',
      )}
    >
      <span className="flex h-9 w-1/3 shrink-0 items-center gap-1.5">
        <Input
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={opts.disabled}
          onChange={(event) => {
            setDraft(event.target.value)
            const parsed = parse(event.target.value)
            if (parsed !== null) onChange?.(parsed)
          }}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(committed === null ? '' : String(committed))
              event.currentTarget.blur()
            }
          }}
          className="min-w-0 flex-1 text-center"
          title="Current value"
        />
        {opts.unit && (
          <span className="text-xs pr-2 text-neutral-400">{opts.unit}</span>
        )}
      </span>
      <div className="min-w-0 flex-1 pr-2">
        <div className="flex h-9 items-center">
          <Slider
            min={opts.min}
            max={opts.max}
            step={opts.step}
            disabled={opts.disabled}
            value={parse(draft) ?? opts.min}
            onValueChange={(next) => {
              const single = Array.isArray(next) ? next[0] : next
              setDraft(String(single))
              onChange?.(single)
            }}
            onValueCommitted={(next) =>
              commitNumber(Array.isArray(next) ? next[0] : next)
            }
          />
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-neutral-400">
          <span title="Minimum">
            {opts.minLabel ?? `${opts.min}${opts.unit}`}
          </span>
          <span title="Maximum">
            {opts.maxLabel ?? `${opts.max}${opts.unit}`}
          </span>
        </div>
      </div>
    </div>
  )
}
