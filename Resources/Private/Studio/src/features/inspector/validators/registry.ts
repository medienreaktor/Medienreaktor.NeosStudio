import { ObservableRegistry } from '@/lib/registry'

/**
 * The property validator registry: every validator - built-in or third-party -
 * registers here under the validator identifier that node type configuration
 * references (the keys of a property's / creation-dialog element's
 * `validation` block, e.g. "Neos.Neos/Validation/NotEmptyValidator"). Both
 * places that edit node properties - the inspector and the node creation
 * dialogs - run their values through this one registry, so a validator written
 * once works in both, and a plugin that registers a custom validator lights up
 * everywhere.
 *
 * Built on the shared observable store (see lib/registry.ts): register-
 * replaces-by-id for idempotent HMR and plugin reloads, and a stable
 * snapshot.
 */

/**
 * A validator checks one value against its configured options and returns
 * either null (valid) or a human-readable error message. Validators never
 * enforce presence unless that is their single job (NotEmptyValidator): an
 * empty value passes every other validator, matching Flow's server-side
 * semantics - "required" and "well-formed" are separate declarations.
 */
export type ValidatorFunction = (
  value: unknown,
  options: Record<string, unknown>,
) => string | null

export interface ValidatorDefinition {
  /**
   * The validator identifier as referenced from node type configuration, e.g.
   * "Neos.Neos/Validation/NotEmptyValidator". Third-party validators should
   * namespace their own ids ('Vendor.Package/Validation/Iban').
   */
  id: string
  /** The check. */
  validate: ValidatorFunction
}

/**
 * Validators in registration order. get(id) yields the definition or
 * undefined - unknown validators are skipped (with a console warning) when
 * validating, see validateValue().
 */
export class ValidatorRegistry extends ObservableRegistry<ValidatorDefinition> {}

export const validatorRegistry = new ValidatorRegistry()

/**
 * A property's / element's `validation` block as configured in the node type:
 * validator identifier -> validator options. YAML authors write an empty
 * options set as `[]`, so values arrive as objects, arrays or null - anything
 * that is not a plain object is treated as "no options".
 */
export type ValidationConfig = Record<string, unknown>

const warnedUnknown = new Set<string>()

/**
 * Run every validator configured on a property/element against a value and
 * collect the error messages; an empty array means the value is valid. An
 * unregistered validator id is skipped (a plugin's validator that is not
 * loaded must not make its properties uneditable) and warned about once.
 */
export function validateValue(
  value: unknown,
  validation: ValidationConfig | null | undefined,
): string[] {
  if (!validation) return []
  const errors: string[] = []
  for (const [id, rawOptions] of Object.entries(validation)) {
    const definition = validatorRegistry.get(id)
    if (!definition) {
      if (!warnedUnknown.has(id)) {
        warnedUnknown.add(id)
        console.warn(`Validator "${id}" is not registered - skipping it.`)
      }
      continue
    }
    const options =
      rawOptions !== null &&
      typeof rawOptions === 'object' &&
      !Array.isArray(rawOptions)
        ? (rawOptions as Record<string, unknown>)
        : {}
    const error = definition.validate(value, options)
    if (error !== null) errors.push(error)
  }
  return errors
}
