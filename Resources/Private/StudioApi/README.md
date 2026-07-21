# @medienreaktor/neos-studio

The public **plugin API type declarations** for Neos Studio. Plugin packages
depend on this to get real, accurate types for the panels/editors/registries
they extend. There is no runtime code here — the shell provides the
implementation at runtime on `window.NeosStudio`, and plugins mark
`@medienreaktor/neos-studio` as an external that resolves to it (see the
example plugin's `vite.config.ts`).

## `index.d.ts` is generated

The single source of truth is the shell's
[`../Studio/src/plugin-api/index.ts`](../Studio/src/plugin-api/index.ts).
`index.d.ts` is bundled from it (one self-contained file, aliases resolved,
tree-shaken) and **committed**, so plugins can typecheck without building the
shell first.

Regenerate whenever the plugin API changes:

```bash
cd Resources/Private/StudioApi
npm install     # first time only
npm run build   # rewrites index.d.ts
```

Then, in each consuming plugin, re-run `npm install` (the `file:` dependency is
copied into the plugin's `node_modules`).

### Why an isolated toolchain

The shell builds with the **TypeScript 7 native compiler**, whose lack of a JS
compiler API breaks declaration bundlers. This package therefore pins classic
**TypeScript 5** plus `dts-bundle-generator` in its own `node_modules`, kept
separate from the shell's.

## Consuming it

```jsonc
// a plugin's package.json
"devDependencies": {
  "@medienreaktor/neos-studio": "file:../../../../Medienreaktor.NeosStudio/Resources/Private/StudioApi"
}
```

Once the shell publishes to a registry, swap the `file:` path for a version
range.
