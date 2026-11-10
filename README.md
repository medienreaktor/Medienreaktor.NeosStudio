# Medienreaktor.NeosStudio

[![Packagist Version](https://img.shields.io/packagist/v/medienreaktor/neos-studio)](https://packagist.org/packages/medienreaktor/neos-studio)
[![PHP Version Support](https://img.shields.io/packagist/dependency-v/medienreaktor/neos-studio/php)](https://www.php.net/)
[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg)](LICENSE)

![Neos Studio](Documentation/Banner.png)

**A fast, modern editing interface for Neos 9 — built for editing together.** Work side by side in the same workspace, organize content work in tasks, control who may edit what, and extend all of it from your own packages.

Studio runs alongside the classic Neos UI. It is a single-page application served at `/neos/studio`. It talks to Neos only through [Neos.Api](https://github.com/medienreaktor/Medienreaktor.NeosApi), an HTTP API secured with OAuth, and does not depend on `Neos.Neos.Ui`. Both interfaces can be used on the same installation.

Why a second UI: the classic UI's plugin API ties extensions to React 16, and its internal protocol between client and server was never meant as a public contract. Studio builds on a documented API instead, and plugins extend it through registries that form its public plugin API.

## Features

### Editing

Everything editors use every day, in a responsive interface that keeps what it has already loaded instead of reloading on every click.

- **Visual Editor**: the rendered page with inline editing. Rich text is edited in place with a floating toolbar (TipTap); special characters like soft hyphens and non-breaking spaces can be inserted.
- **Adding content**: insert before, inside or after any node, from the "+" buttons in the page or the context menus of the trees. Only node types the constraints allow are offered.
- **Documents and Outline**: the document tree and the content structure of the current page, loaded on demand according to the Neos `loadingDepth` settings. Both support drag and drop moves and context menus (copy, cut, paste, delete, hide). A clipboard panel keeps copied and cut nodes across navigation.
- **Inspector**: the property editors of the classic UI (text, text area, rich text, select box with data sources, references, asset, assets, image with cropping, link, date and time, range, boolean, code, node type, URI path segment), the inspector views (NodeInfo, Column, Table, TimeSeries, data source widgets), the `Neos.Neos/Validation` validators, `ClientEval:` expressions and property help. Shine-through values are marked, and a variant can be created with one click, in the inspector and in the page.
- **Media Library**: asset management, also used as the picker for asset properties.
- **Sites and dimensions**: switchers for both.

### Workspaces and publishing

- **Publishing**: pending changes are marked in the trees. The review dialog lists the changes of a workspace and lets you choose what to publish or discard. Syncing with the base workspace shows a dialog for resolving conflicts.
- **Workspaces panel**: the workspaces as a graph, with their unpublished editing steps.
- **History panel**: the unpublished edits of the current page, step by step.
- **Trash**: deleted pages stay in the trash until the deletion is published, with who deleted them and when. They can be restored, together with deleted parent pages.
- **Preview links**: share a page as it looks in a workspace, through a link that expires.
- **Administration**: create and edit workspaces and manage their roles.

### Working together, live

Edit the same content with your colleagues at the same time. No publishing back and forth just to see each other's changes, and no conflicts to sort out afterwards.

Every shared workspace has a _Collaborative_ entry in the workspace switcher. Editors who choose it edit that workspace directly instead of their personal one. Changes by others show up within about two seconds. Changed elements are re-rendered in place in the page, so your scroll position and your own unsaved inline edits stay; structural changes refresh the trees.

This needs nothing beyond Neos. With the optional [realtime sidecar](#the-realtime-sidecar-optional) you also get:

- who else is in the workspace, and where: the page they are on (Documents), the element they are working on (Outline and page, outlined in their color),
- their text as they type it, not only once it is saved,
- changes from others within well under a second.

If the sidecar becomes unreachable, Studio falls back to polling until it is back.

### Tasks

Content work, organized like code: every task is a branch. A task is a workspace of its own, so work on it stays separate from live and from other tasks until it is published.

- **Tasks board**: tasks as cards in the columns _Open_, _In review_ and _Done_, with assignee and number of comments. Moving a card to _In review_ submits the task for review, moving it back to _Open_ reopens it.
- **Review**: moving a card to _Done_ opens the review dialog for the task's workspace, where a reviewer chooses what to publish. Reviewers are the holders of a configurable role (default `Neos.Neos:LivePublisher`).
- **Completion**: once a task's workspace is fully published, the task is marked done, regardless of where it was published from.
- **Workspace switcher**: tasks appear in their own group with their status. Creating a task switches to it.
- **Comments and notifications**: each task has a comment thread. The notification bell collects assignments, review requests, reopened tasks, comments and completions.
- **Access**: task workspaces are regular shared workspaces. The creator and reviewers manage them, the assignee collaborates, and other editors don't see them.

### Access roles

What Sandstorm.NeosAcl offered on earlier Neos versions, rebuilt for Neos 9. Access roles limit what editors can reach. Administrators create them in Studio and assign them to users, without editing `Policy.yaml` or deploying anything.

- **What a role covers**: sites, parts of the document tree, dimensions and workspaces (including live, so "may edit drafts but not publish" is one setting), plus whether the editor may edit, create, delete and move.
- **Document rules**: pick pages in the tree and allow or deny them, with or without their sub-pages. The rule closest to a page decides.
- **Defaults**: a new role restricts nothing. Users without a role are not restricted. Administrators are never restricted.
- **Several roles**: a user may do what any one of their roles allows. Every operation has to be allowed by a single role; roles are not combined.
- **In the UI**: pages outside the roles open read-only, with a note on who can extend the role. Actions that aren't allowed are disabled. The document tree shows only the granted branches, plus their ancestors (dimmed) as the way there. If a role change removes the workspace someone is working in, Studio moves them to one they may use.
- **Enforcement**: writes are checked in the Content Repository itself, so the roles also apply to direct API requests. If a check fails with an error, the write is denied. Reading is restricted per workspace. Pages outside the granted branches are hidden in the UI, but the API does not yet filter them out of node listings and search.

### Users and settings

- User administration for administrators, and profile settings for every editor (name, email, password, interface language, light/dark appearance).
- Access to the classic Neos backend modules from the Studio menu.
- Interface translations in English, German and 12 more languages, through Neos' XLIFF files.

## Extending Studio

Extensibility is built in from the start: the built-in panels, editors and decorators use the same registries that are open to plugins. A plugin's panel is docked, resized and toggled like any built-in one. Plugins register at runtime, and the UI updates when they do.

| Registry             | What you can add                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Panels               | New panels, docked like the built-in ones                                                        |
| Inspector editors    | Property editors for node type properties                                                        |
| Inspector views      | Read-only views and widgets in the inspector                                                     |
| Validators           | Client-side validation                                                                           |
| Link editor tabs     | New link targets in the link dialog                                                              |
| Settings sections    | Sections in the settings dialog (`modals` is a deprecated alias)                                 |
| Workspace decorators | Badges and grouping for workspaces in the switcher and the administration (used for task status) |
| Node decorators      | Icon, badges, tint or dimming of tree rows (used for hidden and deleted nodes)                   |
| Keyboard shortcuts   | App-wide shortcuts                                                                               |

A plugin cannot take Studio down: every registered component (panel, editor, view, settings section, link type) renders inside an error boundary, so one that throws shows a "could not be displayed" notice with a Try again button in its place and logs the error with its registry id, while the rest of Studio keeps working. Throwing decorators, validators and shortcut handlers are logged and skipped. A crashed component tries again when it is registered anew (e.g. after a rebuild) and, for editors and views, on the next node.

A plugin is a small IIFE bundle that uses the shell's plugin API on `window.NeosStudio`: the shell's React, `useStudio()` for app state and actions (`useStudioActions()` for the actions only), the registries, the shell's data layer ([data fetching](#data-fetching)) and its [events](#events). The shell loads the bundle from one `Settings.yaml` entry.

TypeScript types ship with the package in one declaration file, `Resources/Public/Studio/types/index.d.ts` (built by `npm run build:plugin-types`, which runs at the end of `npm run build`). Map the import to it in your plugin's `tsconfig.json` and keep it external in your bundler (it resolves to `window.NeosStudio` at runtime). `react` is external as well, so install `@types/react` and map `react` to it, because the declaration file lies outside your package and TypeScript would otherwise look for `react` next to it:

```jsonc
"paths": {
  "@medienreaktor/neos-studio": ["../../Packages/Plugins/Medienreaktor.NeosStudio/Resources/Public/Studio/types/index.d.ts"],
  "react": ["./node_modules/@types/react"],
  "react/*": ["./node_modules/@types/react/*"],
  "react-dom": ["./node_modules/@types/react-dom"]
}
```

The declaration file is self-contained apart from React: the types of the libraries behind the plugin API (Base UI behind the UI components, ...) are inlined, so a plugin installs none of them.

### UI components

A plugin builds its UI from the shell's own primitives, imported from the plugin API like everything else:

```tsx
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Field, Input } from '@medienreaktor/neos-studio'
```

They are the shell's instances - same React, same Base UI, same portals and theme - so a plugin's dialog, menu or form looks and behaves like a built-in one and follows design changes without a rebuild. Available: `Badge`, `Button`, `Checkbox`, `CollapsibleGroup`, `Combobox…`, `ConfirmDialog`, `ContextMenu…`, `CountBadge`, `Dialog…`, `DropdownMenu…`, `Field`, `Input`, `Placeholder`, `Popover…`, `SearchInput`, `Select…`, `Separator`, `Sheet…`, `Skeleton`, `Slider`, `Spinner`, `LoadingState`, `Table…`, `Tabs…`, `Textarea`, `Toggle`, `ToggleGroup…` and `Tooltip…` (the full list is [`src/plugin-api/components.ts`](Resources/Private/Studio/src/plugin-api/components.ts)). Most follow Base UI's API, e.g. `Select` takes `items`, `value` and `onValueChange` and infers the value type.

Their names and props are the contract; their markup and class names are not. `className` is merged, but the shell's stylesheet only contains the Tailwind utilities the shell itself uses, so a plugin gives its own class names its own CSS (see [Styling plugins](#styling-plugins)) rather than passing Tailwind utilities.

**Start here:** [Medienreaktor.NeosStudio.ExamplePlugins](https://github.com/medienreaktor/Medienreaktor.NeosStudio.ExamplePlugins) registers an example panel, a custom inspector editor (a color picker), a keyboard shortcut and a node decorator from a separate package.

### Data fetching

A plugin reads and writes through `apiFetch` (Neos.Api, with the shell's session) and caches with the shell's TanStack Query: `useQuery`, `useInfiniteQuery`, `useMutation`, `useQueryClient`, `queryOptions`, `skipToken` and `keepPreviousData` come from the plugin API, bound to the shell's client. Its reads then share the shell's cache and show up in the query devtools. Don't bundle `@tanstack/react-query` yourself: a second copy finds no client above your components ("No QueryClient set"). Its types are part of the declaration file.

Start every query key with your package key, e.g. `['Acme.Seo', ...]`. No shell key contains a dot, so they cannot collide, and the prefix refreshes all of your reads at once. The shell's own keys are internal and change with its reads.

```tsx
import { apiFetch, invalidate, useMutation, useQuery, useQueryClient, useStudio, useStudioActions } from '@medienreaktor/neos-studio'

function SeoScore() {
  const { inspectedNode } = useStudio()
  const { nodeEdited } = useStudioActions()
  const queryClient = useQueryClient()
  const score = useQuery({
    queryKey: ['Acme.Seo', 'score', inspectedNode?.nodeAggregateId],
    queryFn: () => apiFetch(`/acme/seo/score/${inspectedNode!.nodeAggregateId}`),
    enabled: inspectedNode !== null,
  })
  const fix = useMutation({
    mutationFn: () => apiFetch(`/acme/seo/fix/${inspectedNode!.nodeAggregateId}`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['Acme.Seo'] })
      nodeEdited(inspectedNode!) // the write changed the node's properties
    },
  })
  // ...
}
```

When a plugin writes Neos content itself, it tells the shell, so that the shell's views show the change:

- For the workspace being edited, call the Studio actions from `useStudioActions()`. `nodeEdited(address, { reload })` after a node's properties or references changed, `nodesEdited(addresses)` after a structural change (created, moved, deleted), and `workspaceContentChanged()` after a publish, discard or rebase. They refresh the node reads, the dirty markers, the trees and the preview.
- `invalidate` refreshes the cached data alone, for any workspace and for code outside components: `invalidate.afterContentEdit(addresses)` (properties or references), `afterStructuralEdit(workspace)` (created, copied, moved, deleted, hidden, retyped), `afterPublish(workspace)`, `afterWorkspaceRewrite(workspace)` (discarded, rebased, base changed) and `afterWorkspacesChanged()` (workspaces created, deleted, roles changed). A workspace is `{ contentRepositoryId, workspaceName }`, so a `NodeAddress` or a `Node` will do. None of them needs to be awaited.

The shell doesn't refresh a plugin's reads by itself. Use the [events](#events) to do that: refresh after the edits, publishes and remote changes your data depends on.

### Events

`events.on(name, handler)` listens to what happens in the shell and returns the unsubscriber. In a component, `useStudioEvent(name, handler)` unsubscribes on unmount and always calls the latest handler:

```tsx
import { events, queryClient, useStudioEvent } from '@medienreaktor/neos-studio'

// Module level: keep the plugin's reads fresh while Studio runs.
for (const name of ['workspace.published', 'workspace.discarded', 'remote.changed'] as const) {
  events.on(name, () => void queryClient.invalidateQueries({ queryKey: ['Acme.Seo'] }))
}

function SeoPanel() {
  useStudioEvent('node.edited', ({ address, name }) => {
    if (name === 'title') console.log('Title saved on', address.nodeAggregateId)
  })
  // ...
}
```

| Event                    | Payload                                                                       | When                                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node.edited`            | `address`, `kind` (`property`, `references`), `name`                          | The editor saved a property or references (inspector or inline). Inline typing saves in bursts, one event per save.                                                              |
| `nodes.structureChanged` | `contentRepositoryId`, `workspaceName`, `change`, `nodeAggregateIds`          | The editor created, copied, moved, deleted, hid, unhid, retyped or restored nodes (`change`: `created`, `copied`, `moved`, `deleted`, `hidden`, `unhidden`, `typeChanged`, `restored`). |
| `workspace.published`    | `contentRepositoryId`, `workspaceName`                                        | The editor published a workspace, or part of it.                                                                                                                                |
| `workspace.discarded`    | `contentRepositoryId`, `workspaceName`                                        | The editor discarded changes of a workspace.                                                                                                                                    |
| `workspace.rebased`      | `contentRepositoryId`, `workspaceName`, `newBaseWorkspaceName`                | The editor synchronized a workspace (`newBaseWorkspaceName` null) or moved it onto another base.                                                                                |
| `workspace.switched`     | `workspaceName`, `previousWorkspaceName`                                      | The workspace being edited changed (personal or shared), or resolved at startup.                                                                                                |
| `site.switched`          | `site`, `previousSite`                                                        | Another site was opened, or the first one resolved.                                                                                                                             |
| `dimension.switched`     | `dimensionSpacePoint`, `previousDimensionSpacePoint`                          | The viewed dimension changed.                                                                                                                                                   |
| `document.selected`      | `node` (or null)                                                              | The selected document changed, also when it follows into another workspace or dimension.                                                                                        |
| `node.inspected`         | `node` (or null)                                                              | The inspected node changed.                                                                                                                                                     |
| `remote.changed`         | `contentRepositoryId`, `workspaceName`, `kind`, `nodeAggregateIds`            | Collaborators changed the shared workspace being edited: `content` (properties of `nodeAggregateIds`), `structure`, or `wholesale` (published, discarded, rebased).             |

The payloads are typed (`StudioEventMap`). The edit and workspace events report what this editor did in Studio, after it succeeded. A plugin's own writes don't emit them. `remote.changed` only fires while a shared workspace is being edited, since only shared workspaces have a change feed. Handlers run after the shell's own work is done and are never awaited. A handler that throws (or rejects) is logged with the event name, and the other handlers still run.

### Plugin API version 2

`NeosStudio.version` is `2` since the Studio runs on Neos.Api instead of Medienreaktor.NeosApi. What a version 1 plugin has to change:

- **Nodes** are Neos.Api's `Node` (`useStudio().selectedDocument`, `inspectedNode`, inspector views, node decorators): `nodeAggregateId` instead of `address`/`aggregateId`, `workspaceName` instead of `workspace`, the dimension space point is a JSON string, `properties[name]` is the plain value instead of `{value, type}`, and `tags` are the node's own tags, its inherited ones are `inheritedTags`.
- **Node addresses** are `NodeAddress` objects (`contentRepositoryId`, `workspaceName`, `dimensionSpacePoint`, `nodeAggregateId`) instead of strings - in the Studio actions (`inspectAddress`, `navigateToNode…`, `nodeEdited`, `nodesEdited`, `reportInlineEdit`) and `PropertyEditorProps.nodeAddress`. A `Node` is one.
- **Asset values** of asset/image properties are written as `{id}` (read as `{id, url}`) instead of `{__flow_object_type, __identifier}`.
- **Workspaces** are Neos.Api's `Workspace`: `baseWorkspaceName` and `ownerId` instead of `baseWorkspace` and `owner`, and there is no `extensions` bag - a workspace decorator keeps its own data (see `features/tasks/decorationData.ts`).
- **Node types** are Neos.Api's `NodeType` (`isAbstract` instead of `abstract`), sites its `Site`.
- **`apiFetch`** talks to Neos.Api (`/api`, see `/api/docs`); the old Medienreaktor.NeosApi routes are gone, the Studio's own operations are content repository scoped (e.g. `/api/cr/{contentRepositoryId}/tasks`).
- **Custom preview guest scripts**: the `…ContextPath` fields of the guest protocol are `…NodeAddress` fields holding the NodeAddress JSON, `guest-ready` carries the guest's `labels` (the host answers with `init`), and the guest answers `flush` with `flushed`.
- `modals` is deprecated in favour of `settingsSections` (still an alias).

## The package family

| Package                                                                                                                        | What it is                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Neos.Api](https://github.com/medienreaktor/Medienreaktor.NeosApi) + [Neos.OAuth](https://github.com/medienreaktor/Neos.OAuth) | The foundation: the HTTP API for Neos 9 (nodes, workspaces, media, users, sites, views, data sources), described with OpenAPI and secured with OAuth 2 (authorization code + PKCE, refresh token rotation, scopes narrowing the account's privileges). |
| **Medienreaktor.NeosStudio** (this package)                                                                                    | The editing UI built on that API, plus the Studio's operations of the Neos API (tasks, notifications, access roles, preview links, the creation dialog).                                                                                               |
| [Medienreaktor.NeosStudio.ExamplePlugins](https://github.com/medienreaktor/Medienreaktor.NeosStudio.ExamplePlugins)            | Plugin boilerplate: example panel + example inspector editor, with the full build setup for extending Studio from your own package.                                                                                                                    |

## Getting started

Requires Neos `^9.2`, PHP `^8.4` and Node 22 (pinned via `.nvmrc`) for building the frontend.

```sh
composer require medienreaktor/neos-studio

# create the Neos.OAuth tables
./flow doctrine:migrate

# build the SPA
cd DistributionPackages/Medienreaktor.NeosStudio/Resources/Private/Studio
nvm use
npm install
npm run build      # outputs to Resources/Public/Studio/ (committed to the repo), plugin types to its types/

# publish and flush on the Neos side
./flow resource:publish
./flow flow:cache:flush
```

Open `/neos/studio` and log in with your Neos backend account. That's it — Studio lazily provisions its own OAuth client on first load; there is nothing to configure.

## The realtime sidecar (optional)

Collaboration works without it. `Resources/Private/Realtime/` contains a small [Hocuspocus](https://github.com/ueberdosis/hocuspocus) WebSocket server. Without it, Studio checks the workspace's events in Neos.Api every two seconds. With it, Studio additionally shows who is in the workspace and colleagues' typing, and changes arrive within well under a second. While the sidecar is unreachable, Studio switches to polling, and stops polling when the sidecar is back.

How it works: each Studio opens one WebSocket per workspace (document name `workspace:<contentRepositoryId>:<workspaceName>`).

- **Presence**: clients send their position, and the sidecar broadcasts the list of users in the workspace. Identity comes from the validated token, not from the client. Closing a tab removes the user.
- **Live typing**: while someone edits text, their changes are passed on to the others about every 200ms. What gets saved still arrives through the change signal.
- **Change signal**: the sidecar checks each active workspace once per `FEED_INTERVAL_MS` and tells the editors in it when there are new events (`{type: 'changed', contentStreamId, sequenceNumber}`). No content passes through the sidecar: each Studio reads the new events from Neos.Api with its own token, so the API's read permissions apply.

### Authentication

Two credentials, deliberately separate:

- Every **client connection** authenticates with the editor's own OAuth bearer token. The sidecar validates it against Neos.Api (a read of `/api/cr/{contentRepository}/workspaces/{name}` proves the token is alive AND the user may read that workspace - an unreadable one is a 404) and resolves identity via `/api/me`.
- The sidecar's own **head reads** authenticate with a shared secret (`X-Realtime-Secret`), configured on both sides: `Medienreaktor.NeosStudio.realtime.sharedSecret` (Neos) and `REALTIME_SHARED_SECRET` (sidecar). While the Neos-side secret is empty, the server-to-server endpoint answers 404 — an unconfigured installation exposes nothing.

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

The SPA sources live in `Resources/Private/Studio/` (Vite, `src/`, `index.html`); the build output goes to `Resources/Public/Studio/`. The realtime sidecar lives next to it in `Resources/Private/Realtime/` (plain Node, no build step).

```
src/
  main.tsx              entry: installs plugin-API globals, mounts the app
  app/                  application shell, providers, shared QueryClient
  auth/                 authorization-code + PKCE flow, token refresh
  api/                  data layer: typed apiFetch(), query-key factory, one hook file per resource
  components/ui/        shadcn-style components on Base UI primitives (owned code)
  features/             one folder per feature: access, clipboard, collaboration,
                        creation, dimensions, editing, inspector, links, media,
                        modals, navigation, notifications, panels, preview,
                        profile, sharing, shortcuts, sites, tasks, tree, users,
                        workspaces
  guest/                the script injected into the preview iframe:
                        inline editing, TipTap RTE, toolbar, link editing
  plugin-api/           the public plugin API surface (window.NeosStudio)
  lib/, hooks/          shared utilities
```

Conventions: every query key comes from `api/keys.ts` (never inline literals); one hook file per API resource; feature folders own their UI and hooks; `@/` aliases `src/`. Styling is Tailwind v4 (CSS-first config) on semantic tokens; primitives are Base UI (`@base-ui/react`), not Radix.

### Design tokens

Colours, radii and text styles come from the [Neos Studio Figma file](https://www.figma.com/design/ks1Uf9OdtvGCA9zjDsSYCu/) through `medienreaktor/figma-tools`, configured by `figma-tools.json`. The Figma dumps (`figma-variables.json`, `figma-text-styles.json`) are checked in, so the export is reproducible without Figma access. From a project that installs figma-tools:

```bash
composer exec -- figma-download --base-path <path to this package>   # refresh the dumps; needs FIGMA_MCP_TOKEN
composer exec -- figma-import --base-path <path to this package>     # regenerate src/styles/*.css
```

`src/styles/{primitives,semantics,sizes,texts}.css` are generated: never hand-edit them, change Figma and re-export. Components use semantic utilities only (`bg-card`, `text-muted-foreground`, `border-divider`, `type-body`, `type-icon-s`), never palette shades or `dark:` variants; Tailwind's own font-size scale is switched off (`src/text-scale.css`). The theme axis is `data-theme="light|dark"` on `<html>`, and any subtree can set its own `data-theme` to render in the other mode. The root font size is left at the browser default, and every length, text sizes included, is in rem, so Studio follows the reader's default font size - also when it changes while Studio is open. That includes lengths JavaScript computes with: graph geometry and panel rects are plain numbers meaning rem, rendered as `${value}rem`. Pixels only exist where code reads the screen - pointer positions, scroll offsets, element and window sizes - and `lib/rem.ts` converts them there, reading the root font size fresh each time.

Sizes are designed for a 16px root on Tailwind's spacing scale, where one step is 4px: `h-8.5` is 34px, `p-3.5` is 14px. Pick the step for the pixel size the design asks for, in half steps at most. Up to 1.18 Studio was laid out at a 15px root; its sizes were carried over by mapping every step to the half step nearest its old pixel size, which is why many of them are half steps (`h-8.5` where the 15px layout had `h-9`). The text styles bring their own line heights from Figma (`type-body` is 18.75px), so a component sets `leading-*` only where it deliberately departs from its style.

### Styling plugins

A plugin's markup is not part of Studio's Tailwind build, so it ships its own CSS. To look like Studio it needs no build of its own and no figma-tools: the shell declares its design tokens as CSS custom properties at runtime, switched with the theme, and plain CSS reads them.

```css
.my-plugin-field {
  padding: calc(var(--spacing) * 2) calc(var(--spacing) * 3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-input) 30%, transparent);
  color: var(--color-foreground);
  font-size: var(--text-body);
  line-height: var(--text-body--line-height);
}
```

The variables a plugin may rely on are listed in [`src/plugin-api/css-variables.json`](Resources/Private/Studio/src/plugin-api/css-variables.json):

- **Colours:** the UI set, `--color-background`, `-foreground`, `-card`, `-popover`, `-muted`, `-accent`, `-border`, `-divider`, `-input`, `-ring`, `-placeholder`, `-link`, `-scrim`, and the roles `primary`, `secondary`, `destructive`, `warning`, `success`, `variant`. A role is its fill (`--color-primary`), the text on that fill (`-foreground`), the role as a text colour on a surface (`-text`), and a translucent background (`-tint`).
- **Radii:** `--radius-sm`, `-md`, `-lg`, `-xl`.
- **Text:** one `--text-{style}` per Studio text style with its `--text-{style}--line-height`: `default`, `body`, `body-strong`, `small`, `small-strong`, `caption`, `count`, `count-small`, `overline`, `heading-s`/`-m`/`-l`, `code`, `code-small`, and the icon sizes `icon-xs` to `icon-3xl`. Weights are not variables: the `-strong` styles are 500, `count`, `count-small`, `overline` and the headings 600, the rest 400; `overline` is also upper case with `letter-spacing: 0.025em`.
- **Fonts and spacing:** `--font-sans`, `--font-mono`, `--font-icon`, and Tailwind's spacing unit `--spacing` (4px at the default root).

Sizes in a plugin follow the same rule as Studio's own: lengths in rem, also where JavaScript computes them, and pixels only where the plugin reads the screen, converted with the root font size read at that moment (`parseFloat(getComputedStyle(document.documentElement).fontSize)`). Then a reader's larger default font size scales the plugin with the shell, even while Studio is open.

Everything else in the build is internal. The build fails when a listed variable goes missing, so a rename in Figma is caught in Studio rather than in a plugin; an intended rename keeps the old name alive through `extraNames` in `figma-tools.json` until the known plugins have moved. Plugin UI should use Studio's [UI components](#ui-components) rather than restyle them; plain CSS on these variables is for the plugin's own layout and the parts no component covers.

### The Studio API

What the Studio adds to Neos (tasks, notifications, preview links, access roles, the creation dialog) are operations of Neos.Api's API itself: [neos/openapi](https://github.com/neos/openapi) Api Classes in `Classes/Endpoint/<Tag>/<Tag>.php` with schematic/jsonschema types (`Schema/`, `RequestBody/`, `Response/`), added to `Neos.OpenApi.FlowAdapter.apis.neos.classes`. So they share everything with Neos.Api's own operations:

- the paths below `/api`, content-repository ones below `/api/cr/{contentRepositoryId}` like Neos.Api's - the shell uses the content repository of the selected site;
- the OpenAPI document (`/api/openapi.json`) and its docs (`/api/docs`); the SPA's types are generated from it (`npm run api:schema` → `src/api/neos/schema/openapi.ts`, never edited by hand), `src/api/studio/schema` names the Studio's models;
- OAuth scopes that are Neos privileges: each capability is a `Neos\Api\Security\ApiPrivilege` target in `Policy.yaml` whose matcher is the scope (`studio.tasks.read`, … in `Security\StudioScopes`). The account's roles decide what is possible, the token's scopes only narrow it down; both are checked before an operation runs, rules depending on a workspace by the operation (`Security\StudioCallers`);
- problem documents, the cache headers, and the tools of Neos.Mcp's MCP server.

Follow Neos.Api's conventions (its `CLAUDE.md`) for new operations. The realtime sidecar's head endpoint is no operation: it authenticates with a shared secret, not a token (`RealtimeController`).

`npm run dev` starts the Vite dev server for fast iteration; end-to-end auth is tested against the built-and-served shell at `/neos/studio` (the OAuth redirect URIs are bound to that origin).

## License

Neos Studio is free software, released under the [GNU General Public License, version 3 or later](LICENSE).

Copyright (C) 2026 medienreaktor GmbH

---

Built by [medienreaktor](https://www.medienreaktor.de) with ❤️ for the Neos community. Feedback, issues and plugin experiments very welcome — this is where the Neos editing experience is headed. Come shape it.
