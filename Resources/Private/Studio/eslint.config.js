// Must stay the first import: lets typescript-eslint load the TypeScript 6
// compiler API while the project itself builds with TypeScript 7 (see there).
import './scripts/eslint-typescript6.js'

import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      // Generated from the Neos.Api OpenAPI document (npm run api:schema).
      'src/api/neos/schema/openapi.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // The React hooks rules, including the React Compiler based checks of
  // eslint-plugin-react-hooks 7 (refs, purity, immutability,
  // set-state-in-effect, ...).
  reactHooks.configs.flat.recommended,

  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      // Type information for the handful of type-aware rules below. The
      // project service reuses tsconfig.json, so this costs one program.
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Cheap type-aware rules that catch real bugs: promises nobody awaits or
      // catches, and promises handed to places expecting a plain callback.
      // Deliberately fire-and-forget calls are marked with `void`.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        // React event handlers may return a promise; React ignores it.
        { checksVoidReturn: { attributes: false } },
      ],

      // Unused bindings are already compile errors (noUnusedLocals /
      // noUnusedParameters); mirror tsc's `_` convention so both agree.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // A missing hook dependency is a bug, not a style question.
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  {
    // Node-side tooling: Vite configs, this file, scripts/.
    files: ['*.{js,ts}', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
)
