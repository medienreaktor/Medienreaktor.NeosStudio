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
          disabled={disabled}
          render={
            <Button
              variant="outline"
              className={cn(
                'h-9 w-full justify-start px-3 font-normal',
                date ? 'pr-8' : undefined,
              )}
            />
          }
        >
          <i className="fas fa-calendar text-neutral-400" aria-hidden />
          {date ? (
            phpFormat(date, format)
          ) : (
            <span className="text-neutral-400">{placeholder}</span>
          )}
        </PopoverTrigger>
        {date && !disabled && (
          // Clear the value without opening the popover.
          <button
            type="button"
            aria-label={t('editor.clear', 'Clear')}
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
            onClick={() => commit(null)}
          >
            <i className="fas fa-xmark text-[0.875rem]" aria-hidden />
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
            className="text-neutral-400"
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
    <div className="w-64">
      <div className="mb-2 flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('editor.dateTime.prevMonth', 'Previous month')}
          onClick={() => onViewMonthChange(addMonths(viewMonth, -1))}
        >
          <i className="fas fa-chevron-left" aria-hidden />
        </Button>
        <span className="text-sm font-medium">{monthLabel}</span>
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
          <div key={index} className="py-1 text-xs text-neutral-400">
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
                'flex h-8 items-center justify-center rounded-md text-sm',
                outside ? 'text-neutral-600' : 'text-white',
                isSelected
                  ? 'bg-blue-500 text-white hover:bg-blue-500/90'
                  : 'hover:bg-neutral-800',
                !isSelected && isToday && 'ring-1 ring-neutral-600',
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
        withDivider && 'mt-3 border-t border-neutral-800 pt-3',
      )}
    >
      <span className="text-xs text-neutral-400">
        {t('editor.time', 'Time')}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Select
          value={String(hours)}
          onValueChange={(next) => onChange(Number(next), minutes)}
        >
          <SelectTrigger size="sm" className="w-16">
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
        <span className="text-neutral-400">:</span>
        <Select
          value={String(minutes)}
          onValueChange={(next) => onChange(hours, Number(next))}
        >
          <SelectTrigger size="sm" className="w-16">
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

// --- date helpers -----------------------------------------------------------

const DATE_TOKENS = new Set('dDjlNSwzWFmMntLoYy'.split(''))
const TIME_TOKENS = new Set('aABgGhHisuv'.split(''))

/** Which parts of a PHP date format string are editable. Defaults to date-only if it names neither. */
function parseFormat(format: string): { hasDate: boolean; hasTime: boolean } {
  let hasDate = false
  let hasTime = false
  for (let i = 0; i < format.length; i++) {
    const char = format[i]
    if (char === '\\') {
      i++ // escaped literal - not a token
      continue
    }
    if (DATE_TOKENS.has(char)) hasDate = true
    else if (TIME_TOKENS.has(char)) hasTime = true
  }
  if (!hasDate && !hasTime) hasDate = true
  return { hasDate, hasTime }
}

function parseIso(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** ISO 8601 (ATOM) in the local timezone, so the picked instant round-trips without a UTC date shift. */
function toAtomLocal(date: Date): string {
  const offset = -date.getTimezoneOffset() // minutes east of UTC
  const sign = offset >= 0 ? '+' : '-'
  const absolute = Math.abs(offset)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  )
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** 42 days (6 weeks) covering the month, starting on the Monday of the first week. */
function monthGrid(month: Date): Date[] {
  const first = startOfMonth(month)
  const mondayOffset = (first.getDay() + 6) % 7 // Mon=0 … Sun=6
  const start = new Date(first)
  start.setDate(first.getDate() - mondayOffset)
  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(start)
    day.setDate(start.getDate() + i)
    return day
  })
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Render a Date with a PHP date() format string - the common subset the inspector needs. */
function phpFormat(date: Date, format: string): string {
  let out = ''
  for (let i = 0; i < format.length; i++) {
    const char = format[i]
    if (char === '\\') {
      out += format[++i] ?? ''
      continue
    }
    out += formatToken(char, date)
  }
  return out
}

function intl(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, options).format(date)
}

function formatToken(char: string, date: Date): string {
  const hours = date.getHours()
  switch (char) {
    case 'd':
      return pad(date.getDate())
    case 'j':
      return String(date.getDate())
    case 'D':
      return intl(date, { weekday: 'short' })
    case 'l':
      return intl(date, { weekday: 'long' })
    case 'N':
      return String(((date.getDay() + 6) % 7) + 1)
    case 'w':
      return String(date.getDay())
    case 'S':
      return ordinalSuffix(date.getDate())
    case 'F':
      return intl(date, { month: 'long' })
    case 'M':
      return intl(date, { month: 'short' })
    case 'm':
      return pad(date.getMonth() + 1)
    case 'n':
      return String(date.getMonth() + 1)
    case 't':
      return String(
        new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate(),
      )
    case 'Y':
      return String(date.getFullYear())
    case 'y':
      return pad(date.getFullYear() % 100)
    case 'a':
      return hours < 12 ? 'am' : 'pm'
    case 'A':
      return hours < 12 ? 'AM' : 'PM'
    case 'g':
      return String(hours % 12 || 12)
    case 'G':
      return String(hours)
    case 'h':
      return pad(hours % 12 || 12)
    case 'H':
      return pad(hours)
    case 'i':
      return pad(date.getMinutes())
    case 's':
      return pad(date.getSeconds())
    default:
      return char
  }
}

function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th'
  switch (day % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}
