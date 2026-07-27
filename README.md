# Medienreaktor.NeosStudio

![Neos Studio](Documentation/Banner.png)

**A revolutionary, blazingly fast, collaborative (multiplayer!) editing UI for Neos 9.** Built from scratch on a clean HTTP API — fully independent of `Neos.Neos.Ui`, free to make its own architectural choices. This is what content editing in Neos can feel like: instant, fluid, together with your team, and open for extension from day one.

Neos Studio is a modern single-page application (Vite + React + TypeScript + TanStack Query + Tailwind CSS v4) that talks to Neos exclusively through [Medienreaktor.NeosApi](https://github.com/medienreaktor/Medienreaktor.NeosApi) — a unified OAuth-secured REST API over the Event-Sourced Content Repository. No Fusion-rendered backend modules, no shared React runtime with the classic UI — just a fast, typed, cache-smart client in front of a well-defined, documented API.

> **Why a new UI?** The classic Neos UI is a great piece of engineering that has served editors well for years — and Studio owes a lot to the ideas it pioneered. But some of its 2016-era architectural constraints are hard to move past today: the plugin API ties extensions to React 16, and the internal wire protocol was never designed as a public contract. Neos Studio starts from a different premise: an API-first backend, a lean modern frontend, and extensibility through observable registries that _are_ the public contract. It grows alongside the classic UI, adopting editing surfaces one at a time.

## Highlights

### 🤝 Collaborative editing — multiplayer for Neos

Edit **together in the same workspace, live**. Every shared workspace offers a _Collaborative_ entry in the workspace switcher: pick it, and you and your colleagues edit the same content directly — no personal-workspace detours, no publish-to-see-each-other, no conflicts to untangle afterwards.

- **See who's there**: avatar initials next to the switcher, markers on the document a colleague is on (document tree) and the element they're focusing (content outliner _and_ live preview, outlined in their color with a nametag).
- **See what they do, as it happens**: colleagues' edits stream in within ~2 seconds. Changed elements re-render **in place** in the preview (out-of-band rendering — your scroll position and your own inline edits survive); structural changes refresh the trees.
- **Nothing extra to install**: no WebSocket server, no Node sidecar, no message broker. The Event-Sourced Content Repository already keeps one totally ordered change log per workspace — Studio simply tails it over plain HTTP through pure PHP endpoints. If it runs Neos 9, it runs multiplayer.
- **Emergent, not a mode**: sessions are ordinary Neos `SHARED` workspaces (create them in the Workspaces module, manage access with the usual roles). Two people in the same workspace — that _is_ the multiplayer. Publishing the session to live works exactly like publishing any workspace.

### ⚡ Blazingly fast, everywhere

- **Instant loads** — a static Vite-built SPA served at `/neos/studio`, with TanStack Query caching and background revalidation. Navigating between documents doesn't reload the world; it reuses what's already in the cache.
- **Silent auth** — Studio provisions its own first-party OAuth client (authorization code + PKCE) on first load. Logged-in backend users get a token silently: no consent screen, no setup, and automatic client-side token refresh.
- **Lazy everything** — document tree and content outliner load on demand, honoring the Neos `loadingDepth` settings, with node type icons, visibility states and pending-change markers.

### 🧩 Dockable panel system

The entire workspace is built from **panels**: document tree, content outliner, inspector, media browser, node creation, clipboard, preview — every surface is a panel that can be docked, resized and toggled. Panels live in a `PanelRegistry`, which means third-party packages register their own panels into the same layout system the built-in ones use. Your panel is a first-class citizen, not an iframe in a corner.

### ✍️ Lightweight inline Rich Text Editing

Inline editing runs on **TipTap 3** — a lean, headless, ProseMirror-based editor instead of a monolithic CKEditor build. The RTE lives _inside the preview iframe_ with a floating toolbar, driven by a guest-side formatting registry, so what you edit is exactly what renders. The same normalized formatting engine powers the inspector's rich-text editor, and the shared Link Editor (with a pluggable tab registry) handles links in both the RTE and the inspector's link fields.

### 🖱️ Context menus and drag & drop

- **Context menus** on every node — in the document tree, the content outliner and the media browser — with copy, cut, paste, delete, hide and more.
- **Drag & drop node moves** in the trees, constraint-aware.
- **Drag-to-create**: pick a node type from the creation panel and drop it straight into the live preview, or use the insert dialog (before / inside / after, filtered by node type constraints).
- A **node clipboard** that survives navigation, with its own panel and document/content separation.

### 🔍 A complete, extensible inspector

Full parity with the classic inspector — and then some:

- **Editors**: text, textarea, rich text, select box (with data source support), references, asset / assets, image, link, date & time, range slider, boolean, code, node type, URI path segment … all registered through an editor registry, all replaceable.
- **Views**: NodeInfo, Column, Table and TimeSeries views plus data-source-driven widgets — through a views registry.
- **Validators**: the `Neos.Neos/Validation` built-ins with live inline errors, tab badges and save-blocking — through a validators registry.
- **ClientEval** support (`ClientEval:` expressions for hidden state and editor options), transient values, and **dimension shine-through indicators** with one-click "create variant" — in the inspector _and_ directly in the preview.

### 🌐 Full editing environment

- **Live preview** with an inline-editing guest bridge — edit content directly in the rendered page.
- **Media module**: full asset management plus picker mode for asset editors.
- **Workspaces, sites and dimensions**: switchers for all three, pending-change tracking, publish and discard.
- **Trash panel**: deleting a node is a soft removal, so every deleted page waits in the trash until the deletion is published — with who deleted it and when, and one click to restore it (deleted parent pages come back with it).
- **User & profile management**: administer users, and every editor gets self-service profile settings (name, email, password, interface language).
- **Localized UI** in English and German via Neos' own XLIFF infrastructure (450+ keys) — translated the Neos way, extendable the Neos way.
- **Consistent design system**: shadcn-style components on [Base UI](https://base-ui.com) primitives, themed with the official Neos UI palette. Dark, focused, familiar.

### 🔌 Extensible by design — registries all the way down

Extensibility isn't bolted on; it's the architecture. Studio's building blocks are **observable registries**:

| Registry          | What you can add                                   |
| ----------------- | -------------------------------------------------- |
| Panels            | Whole new workspace surfaces, docked anywhere      |
| Inspector editors | Custom property editors for any node type property |
| Inspector views   | Custom read-only views and widgets                 |
| Validators        | Custom client-side validation                      |
| Link editor tabs  | New link source types in the shared link modal     |
| Modals            | App-level dialogs                                  |

Third-party packages ship a small IIFE bundle that binds to the shell's public plugin API (`window.NeosStudio` — React instance, `useStudio()` app state, and all registries) with full TypeScript types generated from the shell's own source. The shell injects your bundle via a single `Settings.yaml` entry — no build-system fusion, no webpack surgery, no version lock-in dance. Registration is late-bindable and observable: register, and the UI re-renders.

**Start here:** [Medienreaktor.NeosStudio.ExamplePlugins](https://github.com/medienreaktor/Medienreaktor.NeosStudio.ExamplePlugins) — a copy-me boilerplate that registers an example panel and a custom inspector editor (a color picker) from a completely separate package.

## The package family

| Package                                                                                                             | What it is                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Medienreaktor.NeosApi](https://github.com/medienreaktor/Medienreaktor.NeosApi)                                     | The foundation: OAuth 2.1 (PKCE, refresh token rotation, client credentials, dynamic registration), a read API over the ContentGraph, a write API for CR commands with batching and idempotency, workspace publishing, media API, data sources. Feature-based endpoint policy per role, structural content authorization through the CR itself. Useful far beyond Studio — for integrations, importers and MCP servers. |
| **Medienreaktor.NeosStudio** (this package)                                                                         | The editing UI built on that API.                                                                                                                                                                                                                                                                                                                                                                                       |
| [Medienreaktor.NeosStudio.ExamplePlugins](https://github.com/medienreaktor/Medienreaktor.NeosStudio.ExamplePlugins) | Plugin boilerplate: example panel + example inspector editor, with the full build setup for extending Studio from your own package.                                                                                                                                                                                                                                                                                     |

## Getting started

Requires Neos `^9.1`, PHP `^8.2` and Node 22 (pinned via `.nvmrc`) for building the frontend.

```sh
composer require medienreaktor/neos-api medienreaktor/neos-studio

# build the SPA
cd DistributionPackages/Medienreaktor.NeosStudio/Resources/Private/Studio
nvm use
npm install
npm run build      # outputs to Resources/Public/Studio/ (committed to the repo)

# publish and flush on the Neos side
./flow resource:publish
./flow flow:cache:flush
```

Open `/neos/studio` and log in with your Neos backend account. That's it — Studio lazily provisions its own OAuth client on first load; there is nothing to configure.

## Development

The SPA sources live in `Resources/Private/Studio/` (Vite, `src/`, `index.html`); the build output goes to `Resources/Public/Studio/`.

```
src/
  main.tsx              entry: installs plugin-API globals, mounts the app
  app/                  application shell, providers, shared QueryClient
  auth/                 authorization-code + PKCE flow, token refresh
  api/                  data layer: typed apiFetch(), query-key factory, one hook file per resource
  components/ui/        shadcn-style components on Base UI primitives (owned code)
  features/             one folder per feature: tree, inspector, preview, media,
                        panels, creation, clipboard, editing, links, dimensions,
                        workspaces, sites, users, profile, modals
  guest/                the script injected into the preview iframe:
                        inline editing, TipTap RTE, toolbar, link editing
  plugin-api/           the public plugin API surface (window.NeosStudio)
  lib/, hooks/          shared utilities
```

Conventions: every query key comes from `api/keys.ts` (never inline literals); one hook file per API resource; feature folders own their UI and hooks; `@/` aliases `src/`. Styling is Tailwind v4 (CSS-first config) mapped onto the shadcn token contract with the official Neos palette; primitives are Base UI (`@base-ui/react`), not Radix.

`npm run dev` starts the Vite dev server for fast iteration; end-to-end auth is tested against the built-and-served shell at `/neos/studio` (the OAuth redirect URIs are bound to that origin).

## License

Neos Studio is free software, released under the [GNU General Public License, version 3 or later](LICENSE).

Copyright (C) 2026 medienreaktor GmbH

---

Built by [medienreaktor](https://www.medienreaktor.de) with ❤️ for the Neos community. Feedback, issues and plugin experiments very welcome — this is where the Neos editing experience is headed. Come shape it.
