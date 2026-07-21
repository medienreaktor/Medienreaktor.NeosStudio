import { translateLabel } from '@/lib/i18n'
import type { ValidatorFunction } from './registry'

/**
 * Studio's built-in validators: ports of the fourteen client-side validators
 * the classic UI ships (neos-ui-validators), registered under the same
 * "Neos.Neos/Validation/*Validator" identifiers node type configuration has
 * always used - existing `validation` blocks work unchanged. Semantics follow
 * the originals (and Flow's server-side validators): every validator except
 * NotEmpty treats an empty value as valid, "required" and "well-formed" being
 * separate declarations. Each accepts a `validationErrorMessage` option (a
 * plain string or an XLIFF label id) overriding its default message.
 *
 * Where the originals shipped multi-kilobyte transpiled Unicode character
 * classes (Alphanumeric, Label), these ports use the equivalent native
 * `\p{...}` patterns.
 */

export const ALPHANUMERIC_VALIDATOR =
  'Neos.Neos/Validation/AlphanumericValidator'
export const COUNT_VALIDATOR = 'Neos.Neos/Validation/CountValidator'
export const DATE_TIME_VALIDATOR = 'Neos.Neos/Validation/DateTimeValidator'
export const EMAIL_ADDRESS_VALIDATOR =
  'Neos.Neos/Validation/EmailAddressValidator'
export const FLOAT_VALIDATOR = 'Neos.Neos/Validation/FloatValidator'
export const INTEGER_VALIDATOR = 'Neos.Neos/Validation/IntegerValidator'
export const LABEL_VALIDATOR = 'Neos.Neos/Validation/LabelValidator'
export const NOT_EMPTY_VALIDATOR = 'Neos.Neos/Validation/NotEmptyValidator'
export const NUMBER_RANGE_VALIDATOR =
  'Neos.Neos/Validation/NumberRangeValidator'
export const REGULAR_EXPRESSION_VALIDATOR =
  'Neos.Neos/Validation/RegularExpressionValidator'
export const STRING_VALIDATOR = 'Neos.Neos/Validation/StringValidator'
export const STRING_LENGTH_VALIDATOR =
  'Neos.Neos/Validation/StringLengthValidator'
export const TEXT_VALIDATOR = 'Neos.Neos/Validation/TextValidator'
export const UUID_VALIDATOR = 'Neos.Neos/Validation/UuidValidator'

/**
 * Resolve a validator's error message: the validationErrorMessage option when
 * configured (translated when it is an XLIFF id), else the default message
 * under the classic UI's label ids ("Neos.Neos:Main:content.inspector.
 * validators.*", so existing translations apply), else the English fallback.
 * `{param}` placeholders are substituted in whichever message wins.
 */
function message(
  options: Record<string, unknown>,
  defaultLabelId: string,
  fallback: string,
  params?: Record<string, string | number>,
): string {
  const custom = options.validationErrorMessage
  let text: string
  if (typeof custom === 'string' && custom !== '') {
    // "Vendor.Package:Source:key" - an XLIFF id; anything else is the message.
    text = /^[\w.]+:[\w.-]+:[\w.-]+$/.test(custom)
      ? (translateLabel(custom) ?? custom)
      : custom
  } else {
    text =
      translateLabel(
        `Neos.Neos:Main:content.inspector.validators.${defaultLabelId}`,
      ) ?? fallback
  }
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      text = text.split(`{${key}}`).join(String(value))
    }
  }
  return text
}

const isEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0)

/** A configured bound ("5", 5) as a number, or the given default when absent/unparseable. */
function bound(raw: unknown, fallback: number): number {
  const parsed = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

/** The only validator that fails on emptiness: unset, null, '' or an empty array/object. */
export const NotEmpty: ValidatorFunction = (value, options) => {
  const empty =
    isEmpty(value) ||
    (typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0)
  if (!empty) return null
  return message(
    options,
    'notEmptyValidator.isEmpty',
    'This field is required.',
  )
}

/** Options: minimum (default 0), maximum (default unbounded), ignoreHtml (measure text content only). */
export const StringLength: ValidatorFunction = (value, options) => {
  if (isEmpty(value)) return null
  const minimum = bound(options.minimum, 0)
  const maximum = bound(options.maximum, Number.MAX_SAFE_INTEGER)
  if (maximum < minimum) return 'The maximum is less than the minimum.'
  if (minimum < 0) return 'The minimum string length cannot be less than zero.'
  let text = String(value)
  if (options.ignoreHtml) {
    const parsed = new DOMParser().parseFromString(text, 'text/html')
    text = parsed.body.textContent ?? text
  }
  const length = text.length
  if (length >= minimum && length <= maximum) return null
  if (minimum > 0 && maximum < Number.MAX_SAFE_INTEGER) {
    return message(
      options,
      'stringLength.outOfBounds',
      'Text must be between {minimum} and {maximum} characters long.',
      { minimum, maximum },
    )
  }
  if (minimum > 0) {
    return message(
      options,
      'stringLength.smallerThanMinimum',
      'Text must be at least {minimum} characters long.',
      { minimum },
    )
  }
  return message(
    options,
    'stringLength.greaterThanMaximum',
    'Text must be at most {maximum} characters long.',
    { maximum },
  )
}

/** Options: minimum, maximum. Non-numeric input is its own error; floats are allowed (unlike the old UI's parseInt). */
export const NumberRange: ValidatorFunction = (value, options) => {
  if (isEmpty(value)) return null
  const minimum = bound(options.minimum, Number.MIN_SAFE_INTEGER)
  const maximum = bound(options.maximum, Number.MAX_SAFE_INTEGER)
  if (maximum < minimum) return 'The maximum is less than the minimum.'
  const number =
    typeof value === 'number' ? value : Number(String(value).trim())
  if (Number.isNaN(number)) {
    return message(
      options,
      'numberRangeValidator.validNumberExpected',
      'A valid number is expected.',
    )
  }
  if (number >= minimum && number <= maximum) return null
  return message(
    options,
    'numberRangeValidator.numberShouldBeInRange',
    'The number must be between {minimum} and {maximum}.',
    { minimum, maximum },
  )
}

/**
 * Element count of an array/object value. Options: minimum, maximum. Like the
 * original, an empty collection passes (NotEmpty declares presence), and a
 * value that is not countable at all is an error.
 */
export const Count: ValidatorFunction = (value, options) => {
  if (value === undefined || value === null) return null
  const minimum = Math.max(bound(options.minimum, 0), 0)
  const maximum = bound(options.maximum, Number.MAX_SAFE_INTEGER)
  if (maximum < minimum) return 'The maximum is less than the minimum.'
  if (typeof value !== 'object') {
    return message(
      options,
      'countValidator.notCountable',
      'The value is not countable.',
    )
  }
  const length = Array.isArray(value) ? value.length : Object.keys(value).length
  if (length === 0) return null
  if (length >= minimum && length <= maximum) return null
  return message(
    options,
    'countValidator.countBetween',
    'The count must be between {minimum} and {maximum}.',
    { minimum, maximum },
  )
}

export const Integer: ValidatorFunction = (value, options) => {
  if (isEmpty(value)) return null
  const valid =
    typeof value === 'number'
      ? Number.isSafeInteger(value)
      : /^-?\d+$/.test(String(value)) && Number.isSafeInteger(Number(value))
  if (valid) return null
  return message(
    options,
    'integerValidator.aValidIntegerNumberIsExpected',
    'A valid integer is expected.',
  )
}

export const Float: ValidatorFunction = (value, options) => {
  if (isEmpty(value)) return null
  const valid =
    typeof value === 'number'
      ? Number.isFinite(value)
      : /^[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?$/.test(String(value))
  if (valid) return null
  return message(
    options,
    'floatValidator.validFloatExpected',
    'A valid decimal number is expected.',
  )
}

export const StringType: ValidatorFunction = (value, options) => {
  if (value === undefined || value === null || typeof value === 'string')
    return null
  return message(
    options,
    'stringValidator.stringIsExpected',
    'A text value is expected.',
  )
}

/** Valid "text" contains no XML/HTML tags. */
export const Text: ValidatorFunction = (value, options) => {
  if (value === undefined || value === null) return null
  const text = String(value)
  if (text === text.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, '')) return null
  return message(
    options,
    'textValidator.validTextWithoutAnyXMLtagsIsExpected',
    'Text without any HTML tags is expected.',
  )
}

// The WHATWG HTML5 email pattern - what <input type="email"> validates,
// replacing the old UI's `isemail` dependency.
const EMAIL_PATTERN =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

export const EmailAddress: ValidatorFunction = (value, options) => {
  if (isEmpty(value)) return null
  if (typeof value === 'string' && EMAIL_PATTERN.test(value)) return null
  return message(
    options,
    'emailAddressValidator.invalidEmail',
    'A valid email address is expected.',
  )
}

// ISO 8601 with seconds and an explicit offset (or Z), the format the
// DateTime editor commits; fractional seconds tolerated.
const DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)$/

export const DateTime: ValidatorFunction = (value, options) => {
  if (isEmpty(value)) return null
  if (
    typeof value === 'string' &&
    DATE_TIME_PATTERN.test(value) &&
    !Number.isNaN(new Date(value).getTime())
  ) {
    return null
  }
  return message(
    options,
    'dateTimeRangeValidator.invalidDate',
    'A valid date is expected.',
  )
}

const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

export const Uuid: ValidatorFunction = (value, options) => {
  if (isEmpty(value)) return null
  if (typeof value === 'string' && UUID_PATTERN.test(value)) return null
  return message(
    options,
    'uuidValidator.invalidUuid',
    'A valid UUID is expected.',
  )
}

/** Options: regularExpression - a PHP-style pattern with delimiters, e.g. "/^[a-z0-9\-]+$/i". */
export const RegularExpression: ValidatorFunction = (value, options) => {
  const raw = options.regularExpression
  if (typeof raw !== 'string' || raw === '')
    return 'The validator option "regularExpression" was not given.'
  const match = raw.match(/^\/?(.*?)(?:\/([gimsuy]*))?$/)
  if (!match) return `The pattern ${raw} could not be parsed.`
  let expression: RegExp
  try {
    expression = new RegExp(match[1], match[2])
  } catch {
    return `The pattern ${raw} could not be parsed.`
  }
  if (isEmpty(value) || expression.test(String(value))) return null
  return message(
    options,
    'regularExpressionValidator.patternDoesNotMatch',
    'The value does not match the pattern {pattern}.',
    { pattern: expression.toString() },
  )
}

export const Alphanumeric: ValidatorFunction = (value, options) => {
  if (isEmpty(value)) return null
  if (/^[\p{L}\p{Nd}]*$/u.test(String(value))) return null
  return message(
    options,
    'alphanumericValidator',
    'Only letters and numbers are allowed.',
  )
}

/** A "label": letters, numbers, currency symbols and basic punctuation - no markup. */
export const Label: ValidatorFunction = (value, options) => {
  if (isEmpty(value)) return null
  if (/^[\p{L}\p{Sc} ,.:;?!%§&"'/+\-_=()#0-9]*$/u.test(String(value)))
    return null
  return message(
    options,
    'labelValidator.invalidLabel',
    'Only letters, numbers and basic punctuation are allowed.',
  )
}
