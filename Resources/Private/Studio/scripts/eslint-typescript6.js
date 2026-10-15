/**
 * Point typescript-eslint at the TypeScript 6 compiler API.
 *
 * The Studio type-checks and builds with TypeScript 7 (the native Go port),
 * whose `typescript` package ships the `tsc` binary but no JavaScript compiler
 * API any more. typescript-eslint parses (and, for its type-aware rules,
 * type-checks) through that API, so on its own it would load TypeScript 7's
 * stub and fail. Microsoft publishes the previous API as
 * `@typescript/typescript6` for exactly these consumers.
 *
 * This module installs a synchronous module-resolution hook that answers
 * `typescript` with `@typescript/typescript6` - but only for requests coming
 * from typescript-eslint and its ts-api-utils helper, so nothing else in the
 * process changes. eslint.config.js imports it before typescript-eslint, which
 * is CommonJS and only `require('typescript')`s once it is evaluated, i.e.
 * after this hook is in place. Editors that load eslint.config.js get the same
 * redirection.
 *
 * package.json carries matching `overrides` that let typescript-eslint's peer
 * dependency on `typescript` (<6.1) accept the root TypeScript 7 install, so
 * `npm install` / `npm ci` resolve without --legacy-peer-deps.
 *
 * Drop both once typescript-eslint supports TypeScript 7 natively.
 */
import { registerHooks } from 'node:module'

/** Path fragments of the packages whose `typescript` import is redirected. */
const CONSUMERS = [
  '/node_modules/@typescript-eslint/',
  '/node_modules/typescript-eslint/',
  '/node_modules/ts-api-utils/',
]

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL?.replaceAll('\\', '/') ?? ''
    if (
      (specifier === 'typescript' || specifier.startsWith('typescript/')) &&
      CONSUMERS.some((fragment) => parent.includes(fragment))
    ) {
      return nextResolve(
        specifier.replace(/^typescript/, '@typescript/typescript6'),
        context,
      )
    }
    return nextResolve(specifier, context)
  },
})
