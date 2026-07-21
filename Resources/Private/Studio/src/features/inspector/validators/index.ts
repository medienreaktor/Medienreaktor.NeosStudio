import {
  ALPHANUMERIC_VALIDATOR,
  Alphanumeric,
  COUNT_VALIDATOR,
  Count,
  DATE_TIME_VALIDATOR,
  DateTime,
  EMAIL_ADDRESS_VALIDATOR,
  EmailAddress,
  FLOAT_VALIDATOR,
  Float,
  INTEGER_VALIDATOR,
  Integer,
  LABEL_VALIDATOR,
  Label,
  NOT_EMPTY_VALIDATOR,
  NotEmpty,
  NUMBER_RANGE_VALIDATOR,
  NumberRange,
  REGULAR_EXPRESSION_VALIDATOR,
  RegularExpression,
  STRING_LENGTH_VALIDATOR,
  STRING_VALIDATOR,
  StringLength,
  StringType,
  TEXT_VALIDATOR,
  Text,
  UUID_VALIDATOR,
  Uuid,
} from './builtins'
import { validatorRegistry } from './registry'

/**
 * Studio's built-in validators: the fourteen client-side validators the
 * classic UI ships, each conforming to the shared validator contract (see
 * registry.ts) so the same check serves both the inspector and the node
 * creation dialogs. This barrel registers them under the Neos validator
 * identifiers that node type configuration references.
 */

export {
  ALPHANUMERIC_VALIDATOR,
  Alphanumeric,
  COUNT_VALIDATOR,
  Count,
  DATE_TIME_VALIDATOR,
  DateTime,
  EMAIL_ADDRESS_VALIDATOR,
  EmailAddress,
  FLOAT_VALIDATOR,
  Float,
  INTEGER_VALIDATOR,
  Integer,
  LABEL_VALIDATOR,
  Label,
  NOT_EMPTY_VALIDATOR,
  NotEmpty,
  NUMBER_RANGE_VALIDATOR,
  NumberRange,
  REGULAR_EXPRESSION_VALIDATOR,
  RegularExpression,
  STRING_LENGTH_VALIDATOR,
  STRING_VALIDATOR,
  StringLength,
  StringType,
  TEXT_VALIDATOR,
  Text,
  UUID_VALIDATOR,
  Uuid,
}
export {
  validateValue,
  validatorRegistry,
  useValidator,
  ValidatorRegistry,
} from './registry'
export type {
  ValidationConfig,
  ValidatorDefinition,
  ValidatorFunction,
} from './registry'

/**
 * Register the built-in validators. Called once before the app mounts,
 * exactly like third-party validators would be registered from a plugin
 * entry point.
 */
export function registerBuiltinValidators(): void {
  validatorRegistry.register({
    id: ALPHANUMERIC_VALIDATOR,
    validate: Alphanumeric,
  })
  validatorRegistry.register({ id: COUNT_VALIDATOR, validate: Count })
  validatorRegistry.register({ id: DATE_TIME_VALIDATOR, validate: DateTime })
  validatorRegistry.register({
    id: EMAIL_ADDRESS_VALIDATOR,
    validate: EmailAddress,
  })
  validatorRegistry.register({ id: FLOAT_VALIDATOR, validate: Float })
  validatorRegistry.register({ id: INTEGER_VALIDATOR, validate: Integer })
  validatorRegistry.register({ id: LABEL_VALIDATOR, validate: Label })
  validatorRegistry.register({ id: NOT_EMPTY_VALIDATOR, validate: NotEmpty })
  validatorRegistry.register({
    id: NUMBER_RANGE_VALIDATOR,
    validate: NumberRange,
  })
  validatorRegistry.register({
    id: REGULAR_EXPRESSION_VALIDATOR,
    validate: RegularExpression,
  })
  validatorRegistry.register({ id: STRING_VALIDATOR, validate: StringType })
  validatorRegistry.register({
    id: STRING_LENGTH_VALIDATOR,
    validate: StringLength,
  })
  validatorRegistry.register({ id: TEXT_VALIDATOR, validate: Text })
  validatorRegistry.register({ id: UUID_VALIDATOR, validate: Uuid })
}
