# Medienreaktor.NeosStudio

A modern UI for Neos 9 built entirely on the [Medienreaktor.NeosApi](../Medienreaktor.NeosApi) HTTP API — no coupling to the legacy `Neos.Neos.Ui`. An **editing environment in the making**: workspace-aware document tree and content outliner today, inspector and publishing views next.

- **Stack:** Vite + React + TypeScript + TanStack Query + Tailwind CSS v4 + shadcn/ui (Radix primitives)
- **Lives at:** `/neos/studio` (inside the `/neos/` namespace, so the backend login works cleanly)
- **Auth:** authorization-code + PKCE against the API, using a **first-party** OAuth client (consent screen skipped)

## How it fits together

- `StudioController` serves the built SPA shell at `/neos/studio`. The shell requires a logged-in Neos backend user (see `Configuration/Settings.yaml`).
- On first load it **lazily provisions** a first-party OAuth client `neos-studio` (public, PKCE) whose redirect URI tracks the current origin — zero setup for the operator.
- Runtime config (client id, endpoints, scopes) is injected into the shell as `window.__NEOS_STUDIO__`.
- The SPA runs the PKCE flow: since the client is first-party and the user is already logged in, a token is obtained silently (no consent screen), then stored in `sessionStorage`.
- The shell (a shadcn Sidebar layout) offers site and workspace switchers; the sidebar holds the lazy-loading **document tree** and the **content outliner** of the selected document — with node type icons, visibility states and pending-change markers. The main area is reserved for the inspector.

## Development

The SPA sources live in `Resources/Private/Studio/` (with `src/`, `index.html` and the npm/Vite tooling); the build output goes to `Resources/Public/Studio/`. Node 22 is required (pinned via `.nvmrc`).

```sh
cd DistributionPackages/Medienreaktor.NeosStudio/Resources/Private/Studio
nvm use            # Node 22, see .nvmrc
npm install
npm run build      # outputs to Resources/Public/Studio/ (git-ignored)
```

### Source structure

Server state is managed with **TanStack Query**; the `src/` layout is feature-based:

```
src/
  main.tsx              entry: mounts <AppProviders><App/></AppProviders>
  config.ts             runtime config injected by StudioController
  app/                  application shell
    App.tsx             auth gate + chrome
    providers.tsx       QueryClientProvider (+ devtools, future providers)
    queryClient.ts      shared QueryClient defaults (staleTime, retry policy)
  auth/oauth.ts         authorization-code + PKCE flow
  api/                  data layer
    client.ts           fetch core: typed apiFetch(), throws ApiError
    keys.ts             hierarchical query-key factory — all keys live here
    me.ts, nodes.ts, …  one hook file per API resource
  components/ui/        shadcn/ui components (owned code, added via `npx shadcn add`)
  features/<name>/      one folder per feature (tree/, sites/, workspaces/, …)
  hooks/                shared hooks (shadcn's use-mobile)
  lib/utils.ts          cn() class-merge helper (shadcn convention)
```

Conventions: every query key comes from `api/keys.ts` (never inline literals, or
invalidation misses them); one hook file per API resource in `api/`; feature
folders own their UI and feature-specific hooks; `@/` aliases `src/`.

**Styling:** Tailwind v4 (CSS-first config in `src/styles.css`) themed with the
official Neos UI palette (from `Neos.Neos.Ui/cssVariables.css`) mapped onto the
shadcn token contract. Studio is dark-only: tokens live on `:root` and the
`dark:` variant is pinned to a static `.dark` class on `<html>`. UI primitives
come from shadcn/ui and are vendored into `components/ui/` — edit them freely,
they're ours.

Then publish resources and flush caches on the Neos side:

```sh
./flow resource:publish
./flow flow:cache:flush
```

Open `/neos/studio` (log in when prompted). The built assets are not committed; run `npm run build` after checkout.

`npm run dev` starts the Vite dev server for fast iteration, but the OAuth
redirect URIs are wired for the `/neos/studio` origin, so end-to-end auth is
tested against the built-and-served shell.

## Status

Editing shell: silent first-party auth, site + workspace switchers (personal/
shared only, never live), lazy document tree and content outliner with node
type icons, visibility states and pending-change markers, respecting the Neos
loadingDepth settings. Verified end-to-end against a ddev Neos 9 site.

Roadmap: inspector/editing UI, drag & drop node moves, dimension switcher,
publishing views — replacing legacy Neos.Neos.Ui surfaces one at a time.
