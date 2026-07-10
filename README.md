# Medienreaktor.NeosStudio

A modern UI for Neos 9 built entirely on the [Medienreaktor.NeosApi](../Medienreaktor.NeosApi) HTTP API — no coupling to the legacy `Neos.Neos.Ui`. It starts as an **API debugging console** and is the foundation for a full editing UI.

- **Stack:** Vite + React + TypeScript + TanStack Query
- **Lives at:** `/neos/studio` (inside the `/neos/` namespace, so the backend login works cleanly)
- **Auth:** authorization-code + PKCE against the API, using a **first-party** OAuth client (consent screen skipped)

## How it fits together

- `StudioController` serves the built SPA shell at `/neos/studio`. The shell requires a logged-in Neos backend user (see `Configuration/Settings.yaml`).
- On first load it **lazily provisions** a first-party OAuth client `neos-studio` (public, PKCE) whose redirect URI tracks the current origin — zero setup for the operator.
- Runtime config (client id, endpoints, scopes) is injected into the shell as `window.__NEOS_STUDIO__`.
- The SPA runs the PKCE flow: since the client is first-party and the user is already logged in, a token is obtained silently (no consent screen), then stored in `sessionStorage`.
- The debugging console lets you fire requests against any API endpoint and inspect the response, with quick-actions for the common ones and a live view of your account, roles and token scopes.

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
    client.ts           fetch core: typed apiFetch() + free-form rawRequest()
    keys.ts             hierarchical query-key factory — all keys live here
    me.ts               useMe(); future: nodes.ts, workspaces.ts, …
  components/ui/        generic presentational components
  features/<name>/      one folder per feature (console/, later tree/, …)
  utils/                small generic helpers
```

Conventions: every query key comes from `api/keys.ts` (never inline literals, or
invalidation misses them); one hook file per API resource in `api/`; feature
folders own their UI and feature-specific hooks; `@/` aliases `src/`.

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

v0: API debugging console. Verified end-to-end against a ddev Neos 9 site —
login, silent first-party token acquisition, and authenticated API calls
(reads, commands, workspace operations) all work.

Roadmap: node tree explorer, inspector/editing UI, workspace & publishing
views — replacing legacy Neos.Neos.Ui surfaces one at a time.
