# Medienreaktor.NeosStudio

![Neos Studio](Documentation/Banner.png)

**A revolutionary, blazingly fast, collaborative (multiplayer!) editing UI for Neos 9.** Built from scratch on a clean HTTP API — fully independent of `Neos.Neos.Ui`, free to make its own architectural choices. This is what content editing in Neos can feel like: instant, fluid, together with your team, and open for extension from day one.

Neos Studio is a modern single-page application (Vite + React + TypeScript + TanStack Query + Tailwind CSS v4) that talks to Neos exclusively through [Medienreaktor.NeosApi](https://github.com/medienreaktor/Medienreaktor.NeosApi) — a unified OAuth-secured REST API over the Event-Sourced Content Repository. No Fusion-rendered backend modules, no shared React runtime with the classic UI — just a fast, typed, cache-smart client in front of a well-defined, documented API.

> **Why a new UI?** The classic Neos UI is a great piece of engineering that has served editors well for years — and Studio owes a lot to the ideas it pioneered. But some of its 2016-era architectural constraints are hard to move past today: the plugin API ties extensions to React 16, and the internal wire protocol was never designed as a public contract. Neos Studio starts from a different premise: an API-first backend, a lean modern frontend, and extensibility through observable registries that _are_ the public contract. It grows alongside the classic UI, adopting editing surfaces one at a time.

## Highlights

### 🤝 Collaborative editing — multiplayer for Neos

Edit **together in the same workspace, live**. Every shared workspace offers a _Collaborative_ entry in the workspace switcher: pick it, and you and your colleagues edit the same content directly — no personal-workspace detours, no publish-to-see-each-other, no conflicts to untangle afterwards.

- **See who's there**: avatar initials next to the switcher, markers on the document a colleague is on (document tree) and the element they're focusing (content outliner _and_ live preview, outlined in their color with a nametag).
- **See what they do, as it happens**: colleagues' edits stream in within ~2 seconds — or in well under a second with the realtime sidecar (below). Changed elements re-render **in place** in the preview (out-of-band rendering — your scroll position and your own inline edits survive); structural changes refresh the trees.
- **Nothing extra to install**: no WebSocket server, no Node sidecar, no message broker required. The Event-Sourced Content Repository already keeps one totally ordered change log per workspace — Studio simply tails it over plain HTTP through pure PHP endpoints. If it runs Neos 9, it runs multiplayer.
- **Scales up when you do**: an **optional realtime sidecar** — a small [Hocuspocus](https://github.com/ueberdosis/hocuspocus)-based WebSocket server — upgrades the transport to instant push: presence without heartbeats, one change-feed tail per workspace instead of one poll per editor, sub-second latency. Studio falls back to plain polling automatically whenever the sidecar is unreachable, and back again when it returns. See [the realtime sidecar](#the-realtime-sidecar-optional).
- **Emergent, not a mode**: sessions are ordinary Neos `SHARED` workspaces (create them in the Workspaces module, manage access with the usual roles). Two people in the same workspace — that _is_ the multiplayer. Publishing the session to live works exactly like publishing any workspace.

### 🗂️ Task workflow — feature branches for content

Content work, organized like code: every task is a **feature branch**. Creating a task spins up a workspace of its own, so an editor can pick a task up, check it out, do the work and send it to review — without touching live or stepping on anyone else's changes.

- **A Kanban board, as a panel**: task branches as cards in status columns — _Open_, _In review_, _Done_ — with assignee and comment count. **Dragging a card drives the workflow**: into _In review_ hands the task over, back to _Open_ sends it back — and both ask what to say about it first, exactly as the workspace switcher's menu does.
- **Review before done**: dropping a card on _Done_ never publishes blindly — it opens the Review Changes dialog on the task's workspace, so a reviewer inspects the changes and picks what to publish. Reviewers are whoever holds the configurable reviewer role (default: `Neos.Neos:LivePublisher`).
- **Completion is event-driven**: a catch-up hook on the Content Repository's event stream watches task workspaces — once the branch is fully published, the task flips to done and everyone involved is notified, no matter which surface (or API client) triggered the publish.
- **The branch is the target, not the desk**: taking a task on re-bases your personal workspace onto its branch, so editing continues where it always happens and **"publish" hands your work INTO the task**. The task branch is then published onward at review time — the same move as opening a pull request and merging it, in that order. The topbar's publish button names its destination (`Publish all → Aufgabe 1`), because in a stack of live / draft / task branches "publish" alone says nothing.
- **One click** from the board, the task dialog or the workspace switcher, where task branches sit in their own group with **status-colored badges**. Creating a task — from the switcher or the board — puts you on it immediately. A personal workspace has exactly one base, so this is one task at a time; switching needs your own workspace empty, which the Content Repository enforces and the UI explains.
- Editing *inside* a shared branch — several people on one workspace, seeing each other type — is still available for any workspace through the Workspaces graph. Tasks deliberately use the other mode.
- **Nothing said is lost**: the comment written when submitting and the reason a reviewer gave when handing the task back both join the task's thread. A notification is read once and gone; what a review asked for is still there tomorrow.
- **Notifications built in**: a bell in the top bar collects assignments, review requests, reopens, comments and completions — clicking one jumps straight to the task.
- **Ordinary Neos underneath**: task branches are plain `SHARED` workspaces plus task metadata, with access through standard workspace roles — the creator and reviewers manage, the assignee collaborates, and uninvolved editors never see task branches at all. Publishing, syncing and conflict resolution work like on any workspace.

### 💬 Review conversation — comments where the change is

A review is a conversation, and it belongs next to what it is about — not in a dialog you have to leave the review to open.

- **Comments hang off the workspace, not off the task**: the review most installations actually run is a shared draft against live, which is no task branch. It gets a thread too. A task's thread is simply that thread, plus what its transitions wrote into it.
- **A remark can be pinned to a single change** — one node, in one dimension, on one page. Pinned remarks show up beside the two rendered versions in the compare view, so "this headline is too long" sits next to the headline instead of describing it. All three coordinates are needed: the same element is edited independently per dimension, so a remark on the German headline never surfaces on the English one.
- **Pinned remarks can be settled.** An open one is something still to do; settling folds it away. Pages carry a badge with their open count in the change list and in the compare view's page list, so nothing waits unnoticed on a page nobody opened.
- **Everyone in the conversation hears about it**: previous participants plus whoever the workspace names personally. Group grants are deliberately skipped — a shared draft grants collaboration to a whole editor role, and mailing the entire team on every remark is how notifications get muted.
- Clicking a comment notification opens the **review** on that workspace and the page the remark sits on, not a task board that may not even list it.

### ⚖️ A review with a verdict

The review dialog answers with a decision, not just with a publish button.

- **Request changes** — hands the task back with a required reason. Nothing is published, nothing is discarded, the author's work stays exactly as it is.
- **Discard stays out of the verdict.** It destroys the author's work, which is something to do to your *own* changes — never a reviewer's way of saying no. It keeps its place on the far side of the footer.
- **A publish that empties the branch completes the task — and the dialog says so before you click.** That coupling is not the UI's invention: publishing a selection is `PublishIndividualNodesFromWorkspace`, which reports `partial: !$remainingCommands->isEmpty()`, so covering everything makes it a *full* publish — and the task workflow's catch-up hook completes task branches on exactly that event, whatever triggered it. Publishing a subset stays partial and leaves the task open. The footer spells the consequence out while the selection still covers everything, and the toast confirms it afterwards.
- **Nothing left to publish?** Then *completing* takes over the dialog's primary slot — for the case where the branch was emptied by discarding, or reopened after its changes went out. A card in _In review_ with nothing pending is marked on the board, so it cannot sit there unnoticed either.
- The reviewed task's **title, status and assignee** ride on the workspace object the dialog already has, so the reviewer always knows whose work they are looking at.

### 🔎 Side-by-side review — the pull request, for pages

Reviewing a workspace should not mean reading property values. **Compare changes** opens a full-screen view of one changed page in two rendered versions: live on the left, the reviewed workspace on the right.

- **The change is marked in the page itself**, in the Studio's change colors — edited elements outlined blue on both sides, an added one green on the right, a removed one red on the left, each with a badge naming what happened.
- **Both sides scroll to the same content**, not to the same pixel: the frames report where their content elements sit, and the shell pairs them by node aggregate id into a map between the two scroll positions — so an addition halfway down never drifts the two versions apart.
- **Step through the changes**: next/previous jumps both frames to the element under review and highlights it, starting on the first change when the page opens.
- **Decide right there**: publish or discard the page on screen, page by page, with the same conflict resolution the review dialog uses.
- **Every change reads out, marked or not**: a rendered page can only show what it renders. An alt text, a link target, an SEO title, a page setting — all of them go live with the rest and none of them are visible in a picture of the page. The detail panel below the frames lists the before/after values of the change under review, and changes with nothing to point at stay in the walkthrough, labelled as invisible instead of dropped.
- **Comment on the change under review**: a side panel carries the remarks pinned to it, and stepping to the next change swaps the conversation with it.
- **Read-only by construction**: the frames render the ordinary edit-mode markup but carry a compare script instead of the editing guest — there is no inline editor to open, and no click that could reach one.

Sites can widen what gets marked. Neos' editing markup only annotates the properties it renders as inline-editable text, so anything a site renders into something else — an image, a background, an aria-label — has nothing to attach a mark to. Naming the properties on the element solves it:

```html
<img data-__neos-studio-properties="heroImage,heroImageAlternativeText" />
```

Purely additive: without it the change simply reads out in the detail panel instead of being marked on the page.

### 🔐 Access roles — restrict who reaches what

Dynamic, editable **access roles**: name a set of restrictions and assign editors to it, in the UI, without touching `Policy.yaml` or deploying anything. What the classic distributions solved with Sandstorm.NeosAcl, rebuilt for Neos 9 — where the node-level privilege targets that approach relied on no longer exist.

- **Four axes, one role**: which **sites**, which branches of the **page tree**, which **dimensions**, which **workspaces** — plus the coarse capabilities (edit, create, delete, move) a role may exercise inside them.
- **Pick branches from the tree**: the page-tree tab browses the real document tree; select a page, then allow or deny it, with or without its sub-pages. Allow rules turn the tree into a whitelist, deny rules cut single pages back out — the rule nearest a page wins, so "the whole section except this one page" is two clicks.
- **Permissive by default, at every turn**: a fresh role restricts nothing, an empty list means "all", and a user with **no role assigned is unrestricted** — installing this changes nothing until an administrator hands a role out. Administrators are exempt by design, so a role can never lock the last admin out.
- **Additive**: assign someone two roles and they may do what either allows. Never the intersection, never a surprise.
- **Enforced, not just drawn**: the roles narrow the Studio's UI *and* the Content Repository itself — an `AuthProviderInterface` implementation wraps Neos' own and refuses writes outside a user's roles, so a restriction holds against a hand-crafted API request too. It only ever *narrows* Neos' decision, and fails open on its own errors: a bug here degrades to "no extra restrictions", never to a locked-out editorial team.
- **The tree shows the role, not the site**: only the granted branches and the path down to them appear. The ancestors on that path render dimmed with a lock badge — signposts, not workspaces — and everything else is gone from the tree entirely. The path is resolved server-side per request, so moving a page never strands the branch below it.

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
- **Property help** (`ui.help.message` and `ui.help.thumbnail`) — a popover beside the property label, just like the classic UI.

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

| Registry             | What you can add                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panels               | Whole new workspace surfaces, docked anywhere                                                                                                                                           |
| Inspector editors    | Custom property editors for any node type property                                                                                                                                      |
| Inspector views      | Custom read-only views and widgets                                                                                                                                                      |
| Validators           | Custom client-side validation                                                                                                                                                           |
| Link editor tabs     | New link source types in the shared link modal                                                                                                                                          |
| Modals               | App-level dialogs                                                                                                                                                                       |
| Workspace decorators | Badges and grouping for workspaces in the switcher and administration (this is how task branches get their status colors)                                                               |
| Node decorators      | Per-node visuals on every tree row: replace the type icon, layer badge overlays onto it, tint or dim the whole row (this is how hidden nodes dim and deleted nodes get their red badge) |
| Keyboard shortcuts   | App-wide shortcuts alongside the built-in ones                                                                                                                                          |

Third-party packages ship a small IIFE bundle that binds to the shell's public plugin API (`window.NeosStudio` — React instance, `useStudio()` app state, and all registries) with full TypeScript types generated from the shell's own source. The shell injects your bundle via a single `Settings.yaml` entry — no build-system fusion, no webpack surgery, no version lock-in dance. Registration is late-bindable and observable: register, and the UI re-renders.

**Start here:** [Medienreaktor.NeosStudio.ExamplePlugins](https://github.com/medienreaktor/Medienreaktor.NeosStudio.ExamplePlugins) — a copy-me boilerplate that registers an example panel, a custom inspector editor (a color picker) and a node decorator from a completely separate package.

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

## The realtime sidecar (optional)

Multiplayer needs no extra infrastructure — but it can use some. `Resources/Private/Realtime/` ships a small [Hocuspocus](https://github.com/ueberdosis/hocuspocus) WebSocket server that upgrades Studio's collaboration transport from HTTP polling to push. Without it, everything keeps working: collaboration falls back to plain HTTP polling against the Neos API (2s change feed, 5s presence heartbeat). The fallback is also automatic at runtime — while the sidecar is unreachable, connected Studios poll; when it comes back, they stop.

One WebSocket per editing session (document name `workspace:<name>`):

- **Presence** — clients announce their position as stateless messages; the sidecar keeps a server-authoritative roster per workspace (identity comes from the validated token, never from the client) and broadcasts changes instantly. No heartbeats, no TTL ghosts: a closed tab leaves with its connection.
- **Change feed** — the sidecar tails each active workspace's event feed once per `FEED_INTERVAL_MS` through a shared-secret server-to-server endpoint (`/api/realtime/workspaces/{name}/events`) and fans new events out to every editor. That replaces one API poll _per editor_ per 2s with one poll _per workspace_, and remote edits reach colleagues in well under a second.
- **Yjs seam** — the (currently unused) Yjs document behind each connection is where collaborative text editing attaches later, without a new connection concept.

### Authentication

Two credentials, deliberately separate:

- Every **client connection** authenticates with the editor's own OAuth bearer token. The sidecar validates it against the user-scoped API (a baseline read of `/api/workspaces/{name}/events` proves the token is alive AND the user may read that workspace) and resolves identity via `/api/me`.
- The sidecar's own **feed reads** authenticate with a shared secret (`X-Realtime-Secret`), configured on both sides: `Medienreaktor.NeosStudio.realtime.sharedSecret` (Neos) and `REALTIME_SHARED_SECRET` (sidecar). While the Neos-side secret is empty, the server-to-server endpoint answers 404 — an unconfigured installation exposes nothing.

### Running

```bash
cd DistributionPackages/Medienreaktor.NeosStudio/Resources/Private/Realtime
npm install
REALTIME_SHARED_SECRET=... NEOS_BASE_URL=https://your-site npm start
```

| Variable                 | Default                 | Purpose                                                     |
| ------------------------ | ----------------------- | ----------------------------------------------------------- |
| `PORT`                   | `1234`                  | Listen port                                                 |
| `NEOS_BASE_URL`          | `http://127.0.0.1:8080` | Base URL of the Neos installation                           |
| `NEOS_HOST_HEADER`       | _(none)_                | Host header override for internal hostnames                 |
| `REALTIME_SHARED_SECRET` | _(required)_            | Must equal `Medienreaktor.NeosStudio.realtime.sharedSecret` |
| `FEED_INTERVAL_MS`       | `1000`                  | Feed tail cadence per active workspace                      |

Then point the Studio at it:

```yaml
Medienreaktor:
  NeosStudio:
    realtime:
      websocketUrl: "wss://realtime.your-site.example"
      sharedSecret: "..." # openssl rand -hex 32
```

TLS termination is expected to happen in front (reverse proxy); the sidecar itself speaks plain WS/HTTP.

## Development

The SPA sources live in `Resources/Private/Studio/` (Vite, `src/`, `index.html`); the build output goes to `Resources/Public/Studio/`. `npm run build` runs three Vite builds into it: the SPA, then the two iframe scripts as self-contained IIFEs with stable filenames the PHP side references (`guest.js`, `compare.js`). The realtime sidecar lives next to it in `Resources/Private/Realtime/` (plain Node, no build step).

```
src/
  main.tsx              entry: installs plugin-API globals, mounts the app
  app/                  application shell, providers, shared QueryClient
  auth/                 authorization-code + PKCE flow, token refresh
  api/                  data layer: typed apiFetch(), query-key factory, one hook file per resource
  components/ui/        shadcn-style components on Base UI primitives (owned code)
  features/             one folder per feature: tree, inspector, preview, media,
                        panels, creation, clipboard, editing, links, dimensions,
                        workspaces, compare, tasks, notifications, collaboration,
                        sites, users, profile, modals, shortcuts
  guest/                the script injected into the preview iframe:
                        inline editing, TipTap RTE, toolbar, link editing
  compare/              the read-only script injected into the side-by-side
                        review frames: change markers, anchors, scroll sync
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
