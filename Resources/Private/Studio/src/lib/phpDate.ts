const DATE_TOKENS = new Set('dDjlNSwzWFmMntLoYy'.split(''))
const TIME_TOKENS = new Set('aABgGhHisuv'.split(''))

/** Which parts of a PHP date format string are editable. Defaults to date-only if it names neither. */
export function parseFormat(format: string): {
  hasDate: boolean
  hasTime: boolean
} {
  let hasDate = false
  let hasTime = false
  for (let i = 0; i < format.length; i++) {
    const char = format.charAt(i)
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

export function parseIso(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** ISO 8601 (ATOM) in the local timezone, so the picked instant round-trips without a UTC date shift. */
export function toAtomLocal(date: Date): string {
  const offset = -date.getTimezoneOffset() // minutes east of UTC
  const sign = offset >= 0 ? '+' : '-'
  const absolute = Math.abs(offset)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  )
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** 42 days (6 weeks) covering the month, starting on the Monday of the first week. */
export function monthGrid(month: Date): Date[] {
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

export function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Render a Date with a PHP date() format string - the common subset the inspector needs. */
export function phpFormat(date: Date, format: string): string {
  let out = ''
  for (let i = 0; i < format.length; i++) {
    const char = format.charAt(i)
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
