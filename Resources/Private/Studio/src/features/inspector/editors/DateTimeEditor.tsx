import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { plainEditorOption } from '@/features/inspector/inspectorSchema'
import { translate as t } from '@/lib/i18n'
import {
  addMonths,
  isSameDay,
  monthGrid,
  pad,
  parseFormat,
  parseIso,
  phpFormat,
  startOfMonth,
  toAtomLocal,
} from '@/lib/phpDate'
import { cn } from '@/lib/utils'
import type { PropertyEditorComponent } from './registry'

export const DATE_TIME_EDITOR = 'Neos.Neos/Inspector/Editors/DateTimeEditor'

/**
 * The Neos DateTime editor: one format-driven control that is a date picker, a
 * time picker, or both, exactly as the classic UI's DateTimeEditor. What the
 * `editorOptions.format` string contains decides which parts are editable -
 * date characters (d, m, Y, …) enable the calendar, time characters (H, i, …)
 * enable the hour/minute pickers, so "d.m.Y" is date only, "H:i" time only and
 * "d.m.Y H:i" both (the Neos default is "d-m-Y"). The same string also drives
 * how the selected value is rendered in the trigger, so the inspector shows the
 * date the way the node type asked for it.
 *
 * DateTime properties travel as ISO 8601 (the read API emits
 * DateTimeInterface::ATOM and the command side parses the same shape back), so
 * the editor parses the incoming string into a Date and commits an ATOM string
 * carrying the local timezone offset - the value round-trips losslessly at the
 * instant it was picked. Clearing commits null to unset the property.
 *
 * Like the checkbox, it adopts an external value change without a remount: the
 * inspector edits one subject in place, so a value changed elsewhere must show
 * here too.
 */
export const DateTimeEditor: PropertyEditorComponent = ({
  id,
  value,
  onCommit,
  options,
}) => {
  const format =
    plainEditorOption(options, 'format') ??
    (typeof options.format === 'string' ? options.format : undefined) ??
    'd-m-Y'
  const { hasDate, hasTime } = useMemo(() => parseFormat(format), [format])
  const minuteStep = Math.max(
    1,
    typeof options.minuteStep === 'number' ? options.minuteStep : 5,
  )
  const placeholder = plainEditorOption(options, 'placeholder') ?? '–'
  const disabled = options.disabled === true

  const external = parseIso(value)
  const [date, setDate] = useState<Date | null>(external)
  const [lastExternal, setLastExternal] = useState<number | null>(
    external ? external.getTime() : null,
  )
  const externalTime = external ? external.getTime() : null
  if (externalTime !== lastExternal) {
    setLastExternal(externalTime)
    setDate(external)
  }

  const [open, setOpen] = useState(false)
  // The month the calendar is showing; seeded from the selected date (or now).
  const [viewMonth, setViewMonth] = useState(() =>
    startOfMonth(date ?? new Date()),
  )

  const commit = (next: Date | null) => {
    setDate(next)
    onCommit(next ? toAtomLocal(next) : null)
  }

  const pickDate = (day: Date) => {
    // Keep the current time-of-day when only the date changes.
    const base = date ?? new Date()
    const next = new Date(base)
    next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate())
    if (!hasTime) next.setHours(0, 0, 0, 0)
    next.setMilliseconds(0)
    commit(next)
    if (!hasTime) setOpen(false)
  }

  const setTime = (hours: number, minutes: number) => {
    const base = date ?? startOfMonth(viewMonth)
    const next = new Date(base)
    next.setHours(hours, minutes, 0, 0)
    commit(next)
  }

  const openMonth = (next: boolean) => {
    if (next) setViewMonth(startOfMonth(date ?? new Date()))
    setOpen(next)
  }

  return (
    <Popover open={open} onOpenChange={openMonth}>
      <div className="relative">
        <PopoverTrigger
          id={id}
          // The property label opens the picker (see FieldLabel).
          data-label-opens="click"
          disabled={disabled}
          render={
            <Button
              variant="outline"
              className={cn(
                'h-8.5 w-full justify-start px-3 font-normal',
                date ? 'pr-7.5' : undefined,
              )}
            />
          }
        >
          <i className="fas fa-calendar text-muted-foreground" aria-hidden />
          {date ? (
            phpFormat(date, format)
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </PopoverTrigger>
        {date && !disabled && (
          // Clear the value without opening the popover.
          <button
            type="button"
            aria-label={t('editor.clear', 'Clear')}
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => commit(null)}
          >
            <i className="fas fa-xmark type-icon-l" aria-hidden />
          </button>
        )}
      </div>
      <PopoverContent className="w-auto p-3">
        {hasDate && (
          <MonthCalendar
            viewMonth={viewMonth}
            onViewMonthChange={setViewMonth}
            selected={date}
            onSelect={pickDate}
          />
        )}
        {hasTime && (
          <TimePicker
            date={date}
            minuteStep={minuteStep}
            withDivider={hasDate}
            onChange={setTime}
          />
        )}
        <div
          className={cn(
            'flex items-center justify-between',
            hasDate || hasTime ? 'mt-3' : undefined,
          )}
        >
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => commit(null)}
          >
            {t('editor.clear', 'Clear')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const now = new Date()
              if (!hasTime) now.setHours(0, 0, 0, 0)
              else now.setSeconds(0, 0)
              setViewMonth(startOfMonth(now))
              commit(now)
              if (!hasTime) setOpen(false)
            }}
          >
            {hasTime ? t('editor.now', 'Now') : t('editor.today', 'Today')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** The month grid, Monday-first, with month navigation. Selection only - never commits directly. */
function MonthCalendar({
  viewMonth,
  onViewMonthChange,
  selected,
  onSelect,
}: {
  viewMonth: Date
  onViewMonthChange: (month: Date) => void
  selected: Date | null
  onSelect: (day: Date) => void
}) {
  const today = new Date()
  const days = useMemo(() => monthGrid(viewMonth), [viewMonth])
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: 'long',
        year: 'numeric',
      }).format(viewMonth),
    [viewMonth],
  )

  return (
    <div className="w-60">
      <div className="mb-2 flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('editor.dateTime.prevMonth', 'Previous month')}
          onClick={() => onViewMonthChange(addMonths(viewMonth, -1))}
        >
          <i className="fas fa-chevron-left" aria-hidden />
        </Button>
        <span className="type-body-strong">{monthLabel}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('editor.dateTime.nextMonth', 'Next month')}
          onClick={() => onViewMonthChange(addMonths(viewMonth, 1))}
        >
          <i className="fas fa-chevron-right" aria-hidden />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAY_LABELS.map((label, index) => (
          <div key={index} className="py-1 type-small text-muted-foreground">
            {label}
          </div>
        ))}
        {days.map((day) => {
          const outside = day.getMonth() !== viewMonth.getMonth()
          const isSelected = selected != null && isSameDay(day, selected)
          const isToday = isSameDay(day, today)
          return (
            <button
              key={day.getTime()}
              type="button"
              onClick={() => onSelect(day)}
              className={cn(
                'flex h-7.5 items-center justify-center rounded-md type-body',
                outside ? 'text-placeholder' : 'text-foreground',
                isSelected
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'hover:bg-accent',
                !isSelected && isToday && 'ring-1 ring-placeholder',
              )}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Hour and minute dropdowns (24h), minutes constrained to the configured step. */
function TimePicker({
  date,
  minuteStep,
  withDivider,
  onChange,
}: {
  date: Date | null
  minuteStep: number
  withDivider: boolean
  onChange: (hours: number, minutes: number) => void
}) {
  const hours = date ? date.getHours() : 0
  // Snap the current minute onto the step grid so it matches an option.
  const minutes = date
    ? Math.round(date.getMinutes() / minuteStep) * minuteStep
    : 0
  const minuteOptions = useMemo(() => {
    const list: number[] = []
    for (let m = 0; m < 60; m += minuteStep) list.push(m)
    return list
  }, [minuteStep])

  return (
    <div
      className={cn(
        'flex items-center gap-2',
        withDivider && 'mt-3 border-t border-divider pt-3',
      )}
    >
      <span className="type-small text-muted-foreground">
        {t('editor.time', 'Time')}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Select
          value={String(hours)}
          onValueChange={(next) => onChange(Number(next), minutes)}
        >
          <SelectTrigger size="sm" className="w-15">
            <SelectValue>{() => pad(hours)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {HOURS.map((h) => (
              <SelectItem key={h} value={String(h)}>
                {pad(h)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground">:</span>
        <Select
          value={String(minutes)}
          onValueChange={(next) => onChange(hours, Number(next))}
        >
          <SelectTrigger size="sm" className="w-15">
            <SelectValue>{() => pad(minutes)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {minuteOptions.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {pad(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)

/** Localized Monday-first weekday initials (2024-01-01 is a Monday). */
const WEEKDAY_LABELS = (() => {
  const formatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
  return Array.from({ length: 7 }, (_, i) =>
    formatter.format(new Date(2024, 0, 1 + i)),
  )
})()
