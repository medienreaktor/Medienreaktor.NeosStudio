# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.19.0] - 2026-11-04

### Added

- **Side-by-side comparison of a page.** "Compare" in the Review changes
  dialog opens one changed page in two rendered versions, the base workspace
  on the left and the reviewed one on the right, with every changed element
  marked in both.
  - Scrolling is synchronised by content, not by pixel, so both sides show the
    same elements even where the pages differ in length.
  - Next and previous step through the changes in both frames at once.
  - Changes a rendered page cannot show (an alt text, an SEO title, a link
    target) stay in the walkthrough and are read out in a details panel below
    the frames.
  - Changes are grouped by dimension space point, and the frames render the
    page in the dimension under review.
  - The page can be published or discarded right there, with the same
    conflict resolution as the review dialog.
- **`data-__neos-studio-properties` on site markup** names the properties an
  element renders, so the comparison can mark changes Neos' editing markup
  does not annotate - an image, a background, an `aria-label`:
  `<img data-__neos-studio-properties="heroImage,heroImageAlternativeText" />`.
  Optional; without it such changes appear in the details panel only.
- **Semantic design tokens from Figma, in light and dark.** Colours, radii and
  text styles are generated from the Neos Studio Figma file by
  `medienreaktor/figma-tools`. Components use semantic utilities (`bg-card`,
  `text-muted-foreground`, `border-divider`) and `type-*` text styles; any
  subtree can render in the other theme by setting its own `data-theme`.
- **CSS variables for plugins.** The colours, radii, text sizes with their
  line heights, fonts and the spacing unit are custom properties at runtime,
  so a plugin's plain CSS can look like Studio without a build of its own:
  `font-size: var(--text-body); line-height: var(--text-body--line-height)`.
  `src/plugin-api/css-variables.json` lists the ones plugins may rely on, and
  the build fails when one of them goes missing. The README's "Styling
  plugins" section describes them.

### Changed

- **Studio leaves the root font size at the browser default** instead of
  setting it to 15px. Its own layout was carried over and matches 1.18 to
  within a pixel; a plugin whose own CSS is in rem renders a sixteenth larger.
  The plugin CSS variables keep a plugin in step with Studio.
- **The theme is `data-theme="light|dark"` on `<html>`**, and the semantic
  variables follow it on their own.
- Panel positions and sidebar widths stored in the browser are migrated from
  pixels to rem once, on first load.
- **Every length is in rem, JavaScript included.** Graph geometry, panel and
  sidebar sizes, tree indentation and skeleton rows follow the reader's
  default font size - also when it changes while Studio is open. Pixels
  remain only where code reads the screen (pointer positions, scroll offsets,
  element sizes) and for hairlines.
- **Sizes sit on a 16px spacing scale.** Every spacing and size step was
  mapped to the half step nearest its 1.18 pixel size (`h-9` became `h-8.5`),
  and the text styles keep their 1.18 line heights.
- The mobile breakpoint is `48rem` instead of `768px`, so it moves with the
  default font size like Tailwind's `md`.

### Deprecated

- The `.dark` class on `<html>`. It is still toggled next to `data-theme` for
  plugins that switch on it; read the semantic CSS variables instead.

### Fixed

- A `className` with a `type-*` text style now replaces a component's own text
  style instead of competing with it on CSS order.
- Text inputs carried two text styles at once.
- The last row of a node type card in the node type graph was clipped by the
  card's border.

## [1.18.1] - 2026-10-22

### Removed

- **The access roles' "May create workspaces" flag**: the checkbox in the
  access role dialog's Workspaces tab and the `allowWorkspaceCreation` field of
  the access role constraints. Stored roles that still carry the field load
  without error, but the value is ignored: a role that had it switched off no
  longer prevents anyone from creating a workspace. Creating a workspace is
  checked as Neos checks it, by read access to the base workspace; to keep
  editors from creating shared workspaces, restrict which base workspaces their
  roles can read.

### Fixed

- A restrictive access role no longer blocks the personal workspace Neos
  creates on a user's first login. Creating a workspace used to be held to the
  role's editing rules for the new workspace and its base, and to the
  creation flag. The command cannot tell a personal workspace from a shared
  one, so such a role could leave an editor without a workspace and without
  any content.

## [1.18.0] - 2026-10-21

### Added

- **`apiStream` in the plugin API** reads Server-Sent Events from Neos API
  endpoints, for example the progress of a long-running job. It uses the same
  bearer authentication, token refresh and base URL as `apiFetch`, calls
  `onEvent` for every event as it arrives, can be cancelled with an
  `AbortSignal`, and rejects with `ApiError` on a non-2xx response. The type
  declarations include `apiStream` and `StreamEvent`.

## [1.17.15] - 2026-10-15

### Changed

- **In the live workspace, "Open page in a new tab" opens the page's public
  URL** instead of the Studio preview, so the link can be copied and passed on,
  as in the classic UI. Other workspaces, and live pages without a public URL
  (hidden, or below a hidden page), still open the preview. The new endpoint
  is `/neos/studio/preview/live`, covered by the existing
  `Medienreaktor.NeosStudio:Preview` privilege target.

## [1.17.14] - 2026-10-12

### Fixed

- **Inline editing renders text like the frontend again.** A site's
  paragraph CSS was applied to the paragraph the editor wraps around list
  items, table cells and properties without autoparagraph, a paragraph that is
  never stored. Big numbers lost their heading size, accordion titles lost
  their weight and colour, and list items showed the bullet on a line of its
  own. These paragraphs now render inline and take the surrounding
  typography; real paragraphs in rich text are not affected.

## [1.17.13] - 2026-10-09

### Fixed

- Selecting an element in the preview now scrolls the content tree to it, as
  the classic UI does. In a long outline the node used to stay below the
  visible area. The document tree and the link dialog's document tab behave
  the same way.

## [1.17.12] - 2026-10-09

### Added

- **Open referenced documents from the inspector**, as in the classic UI. In
  the references editor, a click on a label shows the page in the preview. The
  single reference editor has a go-to button next to the remove button.
  References to content nodes, and picks not yet saved, stay plain text.

### Fixed

- The remove button of the references editor uses the translated label
  instead of a hard-coded English title.

## [1.17.11] - 2026-10-07

### Fixed

- An empty inline property (`Neos.Neos:Editable` with `block = false`) can be
  typed into again. Clicking it used to select it without placing the caret.
  The caret now appears at the start of the line, before the placeholder.

## [1.17.10] - 2026-10-07

### Changed

- The preview and shareable preview links show hidden content elements, as
  editors see them in the backend: anyone holding a share link for a page sees
  its hidden elements as well. Removed content is never shown.

### Fixed

- **Hidden pages can be previewed and shared.** The preview and share links
  of a hidden page answered 404, although previewing a page before it goes
  live is the main reason to hide it. The preview now uses the backend user's
  visibility in every rendering mode, as the classic UI's preview does. Both
  render under the Studio's own content cache discriminator, so hidden
  content never reaches a public frontend cache entry.

## [1.17.9] - 2026-10-07

### Fixed

- Enter starts a new paragraph again in properties configured with
  `autoparagraph: true` and `formatting.p: false`; only Shift+Enter worked.
  As in the classic UI, `formatting.p` now only controls the paragraph entry in
  the toolbar, and `autoparagraph` alone decides whether Enter adds
  paragraphs.

## [1.17.8] - 2026-10-06

### Added

- **Inline styles in the block toolbar.** With a collapsed caret, the block
  toolbar now lists inline styles too, not only block styles, as the classic
  UI's style dropdown did. Sites that define whole-block looks as inline
  styles (for example a heading look applied through a `<span>`) no longer
  require selecting the text first. Applied at the caret, such a style wraps
  the whole text block and the caret stays where it was.

### Fixed

- **A blank line is stored as `<p>&nbsp;</p>`, as CKEditor stores it.**
  Pressing Enter twice left an empty `<p></p>` that collapses to zero height
  in the frontend, so text edited in Studio lost its paragraph spacing.
  Stored fillers load back as empty paragraphs rather than as a real space.

## [1.17.7] - 2026-09-30

### Fixed

- Opening or reloading a page keeps the preview at the top. Selecting the
  document node, which sites often wrap around the whole page body, scrolled
  the preview partway down the page. The document stays outlined, and
  selecting content elements still scrolls them into view.

## [1.17.6] - 2026-09-28

### Fixed

- Content laid over an image, such as a hero heading, can be hovered, clicked
  and edited again while the image's "Select image" overlay is shown. Only
  the overlay's button captures the pointer now.

## [1.17.5] - 2026-09-28

### Changed

- The "Based on" picker of the Create task dialog shows the workspace icons
  and task status badges used in the switcher and the review dialog.
- The review dialog's "Publish selected" button uses the check icon.
- Requires `medienreaktor/neos-api` ^1.17.5.

## [1.17.4] - 2026-09-28

### Changed

- **One "Review and publish" button replaces "Review" and "Publish all".** It
  opens the review dialog with every changed document preselected, so
  publishing always goes through the dialog. Anyone can review; publishing
  needs write access to the base workspace (`Neos.Neos:LivePublisher` for
  live) and, with access roles, permission to publish to live. The button
  and its target badge are blue for live and purple otherwise.
- **The workspace switcher names both the checked-out workspace and its
  publish target**, with a "→ target" badge that is green for live and orange
  for a shared workspace.
- **The review dialog** shows workspace icons (live, shared, personal,
  private, or a task's own icon and colour) and task status badges in both
  pickers, shows counts as badges, keeps "Publish selected" green, and closes
  after a publish or discard, including after a resolved conflict.
- The confetti burst for a successful publish now plays from the review
  dialog. The `publishCelebration` setting still turns it off.
- Preview and Share form one icon-only split button next to the dimension
  switcher. Sync is icon-only and orange whenever it is shown.
- Requires `medienreaktor/neos-api` ^1.17.4.

### Removed

- The topbar's direct "Publish all" action.

### Fixed

- Changed interface labels show up immediately. The label bundle is
  requested with the core's translation cache version, as in the classic
  backend, instead of staying in the browser cache for a week.

## [1.17.3] - 2026-09-24

### Fixed

- **The preview tab stays a preview.** Links in a page opened in a separate
  tab used to lead into Neos' own preview in an editing mode, where links
  often do not navigate. They now stay in the Studio preview and its
  rendering mode. Previewing another document reuses the open preview tab
  instead of opening a new one, as in the classic UI.

## [1.17.2] - 2026-09-17

### Fixed

- **Plugins registered under `Medienreaktor.NeosStudio.plugins` are no
  longer dropped in some installations.** The package's own empty default
  for that setting replaced the entries of any package whose settings were
  merged before it. Whether a plugin survived therefore depended on package
  load order, and the affected properties fell back to a read-only editor.

## [1.17.1] - 2026-09-15

### Changed

- **Inline editing handles `autoparagraph` the way the classic Neos UI does.**
  Inline properties without an `autoparagraph` setting no longer get
  paragraphs; set `autoparagraph: true` to keep them. Values already stored as
  `<p>…</p>` keep the tag until they are next edited. In the inspector's rich
  text editor, only an explicit `autoparagraph: false` has this effect.

### Fixed

- **No stray `<p>`:** properties with `autoparagraph: false` are stored as
  bare text (`Title` instead of `<p>Title</p>`), in inline editors and in the
  inspector. Headings and paragraphs with a class or alignment keep their
  tags.
- **Enter inserts a line break** in these properties instead of doing
  nothing. List items, table cells and code blocks keep their own Enter
  handling.
- **Same rules as the classic UI:** autoparagraph is also off for inline
  properties rendered as a `<span>` (`block = false`) or `<h1>`–`<h6>`, and
  for inline properties that do not set `autoparagraph` at all.

## [1.17.0] - 2026-09-14

### Added

- **The session's CSRF token is available to plugins** as `csrfToken` in the
  shell configuration. Plugins that call classic, session-authenticated
  backend routes can send it as the `X-Flow-Csrftoken` header, as the classic
  UI does.

## [1.16.2] - 2026-09-08

### Fixed

- The highlight on an element revealed by a deep link is now easy to notice:
  it waits until scrolling has finished and blinks twice, clearly, over 1.8
  seconds. It used to play while the page was still scrolling and was too
  faint to see.

## [1.16.1] - 2026-09-08

### Fixed

- The deep-link highlight is no longer sent to the previously open document,
  which loads first on startup. It now waits for the linked one.

## [1.16.0] - 2026-09-08

### Added

- **Deep links can point at a content element.** Add
  `?reveal=<aggregate id>` next to `?node=` to select that element once the
  document has loaded. The element is scrolled into view, outlined, and
  briefly highlighted (a static tint with `prefers-reduced-motion`). An ID
  that no longer resolves falls back to opening the page.

## [1.15.0] - 2026-09-08

### Added

- **Deep links into Studio.** `/neos/studio?node=<base64url node address>`
  opens that document, so backend features such as search results, reports or
  notifications can link editors into Studio instead of the classic content
  module. The link survives the login redirect. Only the node and its
  dimensions are taken from the address; the workspace stays the editor's
  current one, so a link that names live does not put the editor in live.
  The parameter is removed from the visible URL right away, and malformed
  links are ignored.

## [1.14.3] - 2026-09-02

### Changed

- **One boot screen until the shell is ready.** A full-viewport spinner
  covers the Studio from first paint until the first preview page has rendered
  and no request is pending, instead of the panels assembling themselves one
  spinner at a time. It gives way after 15 seconds, or earlier when no site can
  be opened or the root document fails to resolve. The transient "Select a
  document…" placeholders in the preview and the outliner are gone, along with
  their translation keys.
- **Stacked dialogs.** A dialog that opens another one, such as the settings
  modal opening a role, site or user dialog, now dims and steps back behind it.
  Dialog enter and exit animations ease their scale instead of snapping.
- Settings pages sit closer to the dialog header.
- Requires `medienreaktor/neos-api` ^1.14.3.

### Fixed

- **Escape leaves the asset picker.** Pressing Escape while the Media Library
  is in picker mode cancels the pick and returns to the previous tab, like the
  banner's Cancel button, which now shows an Esc hint. The Media Library takes
  keyboard focus when picking starts, so this also works when the pick began in
  the preview or the inspector. An open popup or search field still takes the
  first Escape.
- The Media Library tab is solid blue while a pick is pending in dark mode
  too.

## [1.14.2] - 2026-08-31

### Added

- **`Medienreaktor.NeosStudio.publishCelebration`** turns off the confetti
  burst after a successful "Publish all" for the whole installation. It
  defaults to `true`; editors whose system asks for reduced motion never see
  the animation either way.

### Changed

- **Inspector tabs show their icons only and wrap**, as in the classic Neos
  inspector, instead of scrolling labelled tabs sideways off the edge of the
  panel. The label remains available to screen readers and as a tooltip, and a
  tab configured without an icon keeps its label.
- Requires `medienreaktor/neos-api` ^1.14.1.

## [1.14.1] - 2026-08-27

### Changed

- The access role editor's "Page tree" tab is called "Documents", in line with
  the Neos naming.

## [1.14.0] - 2026-08-27

### Added

- **Tree context menus act on the whole multi-selection.** In the document
  tree and the content outliner, right-clicking a row that belongs to a
  Cmd/Ctrl/Shift selection applies the menu to every selected node;
  right-clicking outside the selection selects that row instead, as in a file
  manager. Hide, Unhide and Delete skip the nodes they cannot act on (tethered,
  not permitted, already in the wanted state) and show a count, such as
  "Delete (3)"; a mixed selection offers Hide and Unhide side by side, and the
  delete confirmation names the count. Selected nodes whose ancestor is also
  selected are left out, since the ancestor covers them.
- **Cut and Copy capture the selection as one clipboard entry**, in document
  order, and Paste inserts the whole group in one batch, keeping its order, for
  moves and copies alike. Paste is offered only where every captured node type
  is allowed. The Clipboard panel shows a group as its first label plus "+2",
  with the full list in the tooltip, and a cut group dims all its rows in the
  trees. Commands in a batch are not transactional: if one fails, the ones
  before it stay applied as discardable workspace changes.
- **Duplicating in place**: "Paste after" on the very node a copy was taken
  from now duplicates it. Pasting into the node itself, or pasting a cut entry
  after itself, stays blocked.

### Fixed

- Right-clicking in the media tree no longer desyncs its highlighted row from
  the active filter.

## [1.13.0] - 2026-08-25

### Added

- **Dynamic access roles.** Administrators create named restriction sets in a
  new Access roles section of the settings, and assign editors to them, without
  `Policy.yaml` or a deployment. A role narrows sites, branches of the document
  tree (picked from the real tree, allowed or denied with or without
  sub-pages), dimensions and workspaces, including live, plus the capabilities
  edit, create, delete and move. An empty list means unrestricted. Roles are
  additive, and a single role must cover the whole operation, so "may edit the
  draft" and "may read live" never combine into writing on live.
- **Restrictions are enforced by the content repository**, which refuses writes
  outside a user's roles even for hand-crafted API requests. The check can only
  add a refusal on top of Neos' own decision, never grant anything, and lets
  requests through if it fails itself. Live stays readable for everyone, so
  the website keeps rendering for a role's members.
- **The shell follows the roles.** The document tree shows only granted
  branches and the path down to them, with the ancestors on that path dimmed
  and locked. Pages outside a role render as a read-only preview with the
  inspector disabled and a notice; withheld capabilities disable their context
  menu actions, drag and drop, the creation panel and the New-page button.
  Site, dimension and workspace switchers narrow to what a role leaves open,
  and blocked dimension values show a lock. A user whose role changes
  mid-session so that they may no longer write in their current workspace gets
  a dialog that moves them to a permitted one.
- **Node listings and document search are filtered server-side**, so pages a
  role hides do not surface as search hits. Unrestricted accounts skip the
  filter entirely.
- Users without a role stay unrestricted, and members of
  `Neos.Neos:Administrator` are never restricted, so nothing changes until an
  administrator assigns a role.
- Database migrations for the tables holding access roles and their members;
  run `./flow doctrine:migrate`.
- Settings under `Medienreaktor.NeosStudio.accessControl`: `bypassRoles` (Flow
  roles never restricted, default `Neos.Neos:Administrator`),
  `restrictUnassignedUsers` (`true` makes a user without a role deny-all;
  default `false`) and `enforceContentRepository` (default `true`; `false`
  keeps the roles a pure UI feature without refusing writes in the content
  repository).
- The privilege target `Medienreaktor.NeosStudio:Api.AccessRoles.Write` for
  managing access roles, granted to `Neos.Neos:Administrator`; every editor may
  read their own effective access.

### Changed

- **The package sets the content repository's `authProvider`** on the
  `default` preset (`Neos.ContentRepositoryRegistry.presets.default`) to a
  factory that wraps Neos' own provider. An installation that configures its
  own `authProvider` there has to decide which one wins.
- Requires `medienreaktor/neos-api` ^1.13.0, which provides the node read
  filter interface the access roles plug into.

### Fixed

- Dialogs no longer let wide content, such as a long tab strip or an
  unbreakable string, spill out past their right edge.

## [1.12.1] - 2026-08-24

### Changed

- Requires `medienreaktor/neos-api` ^1.12.1.

### Fixed

- **The rich text editor stores lists and table cells like CKEditor.** It
  used to wrap the content of every list item, including nested ones, and of
  single-paragraph table cells in a `<p>` on the first edit, which leaked into
  the stored markup.

## [1.12.0] - 2026-08-24

### Changed

- **The link editor's "Asset" tab is called "Media"**, matching the Media
  Library, and browses media like the Media Library. It no longer shows a
  caption for the linked asset.
- Panels and their toolbars are roomier, and the search and filter controls in
  the Documents tree, the node creation panel and the Media Library header
  float on their own translucent surface over a toolbar that fades into the
  content below.
- Requires `medienreaktor/neos-api` ^1.12.0.

### Fixed

- In Safari, scrolled content no longer shows as a thin line above the panel
  toolbars.

## [1.11.2] - 2026-08-24

### Added

- **Property help in the inspector.** `ui.help.message` and
  `ui.help.thumbnail` on a property render as a question-mark icon beside its
  label, opening a popover with the message and thumbnail, as in the classic
  UI. `resource://` thumbnails resolve. The scope hint opens the same way, by
  clicking its icon rather than the whole label.

### Changed

- Requires `medienreaktor/neos-api` ^1.11.2.

### Fixed

- The link editor keeps its height when the document tree is expanded, which
  now scrolls instead of growing the dialog past the viewport.

## [1.11.1] - 2026-08-19

### Changed

- The active tab carries a subtle top border.
- Requires `medienreaktor/neos-api` ^1.11.1.

## [1.11.0] - 2026-08-19

### Added

- **A menu next to the logo lists the classic Neos backend modules**, filtered
  by the user's privileges and labelled in their interface language. Its
  Content group links to Neos Studio and, when `Neos.Neos.Ui` is installed, to
  the classic UI. It is on by default; set
  `Medienreaktor.NeosStudio.enableLegacyModules` to `false` to hide it.

### Changed

- **The notification bell only appears while something is unread**, and the
  "Clear notifications" action is gone. Notifications and tasks are polled
  every five minutes instead of every 30 seconds; your own actions still
  update them immediately.
- The sidebar toggle shows a panel icon instead of a hamburger.
- Requires `medienreaktor/neos-api` ^1.11.0.

## [1.10.0] - 2026-08-19

### Added

- **Node creation handlers run.** The creation dialog sends all its element
  values along with the create command, so a node type's server-side
  `nodeCreationHandlers` (promoted elements, packages like
  `Flowpack.NodeTemplates`) work as in the classic UI. Elements named after a
  property still set that property, and win over handler output.

### Changed

- Requires `medienreaktor/neos-api` ^1.10.0, which runs the node creation
  handlers.

## [1.9.10] - 2026-08-18

### Added

- **Preview button in the top bar**, next to Share: opens the selected
  document in a new tab as visitors see it, in the active workspace and
  dimension. Deleted pages still render. It replaces the open-in-new-tab
  button that went away with the preview toolbar in 1.7.

### Changed

- The header toolbar switches to icon-only buttons at wider widths than before,
  so presence avatars or a Synchronize button on an outdated workspace can no
  longer push it past the edge. Synchronize and Publish now lose their labels
  too, and a long workspace title in the switcher is truncated.
- Requires `medienreaktor/neos-api` ^1.9.10.

## [1.9.9] - 2026-08-18

### Changed

- Requires `medienreaktor/neos-api` ^1.9.9.

### Fixed

- **Sites that wrap an element's metadata twice** (once around the element,
  again around its inner content area) no longer nest the element inside itself
  each time an edit re-renders it in place. Selection, edit locks and outlines
  all treat the outermost wrapper as the element.
- Content collections no longer get a background tint on hover or selection.

## [1.9.8] - 2026-08-18

### Changed

- No functional changes; requires `medienreaktor/neos-api` ^1.9.8.

## [1.9.7] - 2026-08-18

### Changed

- Requires `medienreaktor/neos-api` ^1.9.7.

### Fixed

- **Safari kept showing outdated content** even after 1.9.6, because it still
  answered from responses it had cached earlier. In-place element renders and
  preview loads now use a unique URL each time. The Studio shell page is sent
  `no-store` too, so a cached shell can no longer hold on to an old bundle
  after a deploy.

## [1.9.6] - 2026-08-18

### Changed

- Requires `medienreaktor/neos-api` ^1.9.6.

### Fixed

- **Safari showed stale previews and element renders after an edit.** The
  preview is now sent with `Cache-Control: private, no-store` instead of
  `no-cache`, and the shell no longer lets the browser cache answer API reads.

## [1.9.5] - 2026-08-10

### Changed

- Requires `medienreaktor/neos-api` ^1.9.5.

### Fixed

- The realtime sidecar now actually sends `NEOS_HOST_HEADER`. Node's built-in
  `fetch` silently dropped the `Host` header, so behind a host-based redirect or
  rewrite every authentication check and feed read failed. The sidecar doesn't
  follow redirects and stops waiting for a request after 30 seconds.

## [1.9.4] - 2026-08-10

### Changed

- Requires `medienreaktor/neos-api` ^1.9.4.

### Fixed

- A document property with `ui.reloadIfChanged`, and hiding or unhiding a
  document, now reloads the preview right away, as in the classic UI. Before,
  Studio first tried an in-place update that could not work for documents, and
  that led to timeouts and flicker. Content elements still update in place.

## [1.9.3] - 2026-08-10

### Changed

- Requires `medienreaktor/neos-api` ^1.9.3.

### Fixed

- The image and asset editors in the inspector pick up changes made elsewhere.
  An image chosen through the preview's image overlay, or changed by a
  collaborator, used to show the old asset until a full browser reload.

## [1.9.2] - 2026-08-10

### Changed

- Requires `medienreaktor/neos-api` ^1.9.2.

### Fixed

- **Elements re-rendered in place keep their editing setup.** Inline editors in
  swapped fragments used to fall back to the default block settings: they
  accepted paragraphs and lost style classes. Root-level editors and
  collection add buttons also stayed missing.
- Assigning an image no longer discards the first pick when it reveals
  dependent fields in the inspector (`ClientEval` visibility changes).
- A caret left in an element no longer keeps your own changes from refreshing
  it while the preview window is not focused.

## [1.9.1] - 2026-08-10

### Added

- **Edit locks for collaborative editing.** The content element you select is
  locked for you. Colleagues see it read-only with a pencil badge, the
  inspector shows who holds the lock, and clicks and hovers inside it are
  ignored. When the holder moves on or disconnects, the next person waiting
  gets the lock. Documents are never locked.
- **Live typing.** While you hold a lock, colleagues see your text and caret
  update as you type, with your name on the caret.
- Edit locks and live typing need the realtime sidecar; without one,
  collaboration works as before.

### Changed

- **Inline edits save while you type**: 1.5 seconds after the last keystroke,
  at least every 5 seconds while you keep typing, and when you leave the field.
  This matches the classic UI.
- In the Workspaces history graph, a run of typing saves by one person on one
  node shows as a single step.
- Requires `medienreaktor/neos-api` ^1.9.1.

## [1.9.0] - 2026-08-06

### Added

- **Optional realtime sidecar** for collaboration: a WebSocket server based on
  Hocuspocus. Presence and colleagues' changes arrive in under a second.
  Polling now happens once per workspace instead of once per editor every 2
  seconds. If the sidecar is unreachable, Studio switches back to HTTP polling
  on its own, and uses the sidecar again once it is back.
- **Light, dark and system UI modes**, chosen per user in the profile settings
  from macOS-style preview tiles. The whole interface has been restyled for
  the light mode, and system mode follows the operating system. Dark is the
  default.
- The sidecar is the Node server in `Resources/Private/Realtime/` (Node 22 or
  newer, `npm install`, `npm start`), configured with `REALTIME_SHARED_SECRET`
  and `NEOS_BASE_URL`; TLS is expected to end at a reverse proxy in front of
  it. On the Neos side, the settings
  `Medienreaktor.NeosStudio.realtime.websocketUrl` and
  `Medienreaktor.NeosStudio.realtime.sharedSecret` connect it; the secret must
  equal the sidecar's `REALTIME_SHARED_SECRET`.
- The endpoint `/api/realtime/workspaces/{name}/events`, through which the
  sidecar reads the change feed with the shared secret. It answers 404 while
  `sharedSecret` is empty.

### Changed

- Requires `medienreaktor/neos-api` ^1.9.0.

## [1.8.0] - 2026-08-06

### Added

- **The interface is translated into all 14 languages Neos offers**: Danish,
  Spanish, Finnish, French, Khmer, Latvian, Dutch, Norwegian, Polish,
  Brazilian Portuguese, Russian and Simplified Chinese join English and German.
  Each language uses the same terms as the classic Neos UI.

### Changed

- The language dropdown in the profile settings shows each language's own name
  first, followed by its English name in grey.
- Requires `medienreaktor/neos-api` ^1.8.0.

## [1.7.6] - 2026-08-06

### Changed

- Requires `medienreaktor/neos-api` ^1.7.6.

### Fixed

- While an edited node reloads, the trees keep showing its row. Hiding or
  unhiding a node used to flash a loading placeholder and a stray expand arrow.

## [1.7.5] - 2026-08-06

### Added

- **Node decorators**, a new plugin registry (`nodeDecorators` on
  `window.NeosStudio`) that controls how a node looks in every tree: document
  tree, content outliner, search results and document pickers. A decorator can
  replace the type icon, add a badge to a corner of the icon, or change the
  color or opacity of the whole row. Studio's own type icons and its marks for
  hidden and hidden-in-menu nodes use the same registry.
- Deleted nodes, where they appear in a tree, are dimmed, and the deleted node
  itself has a trash-can badge.

### Changed

- Requires `medienreaktor/neos-api` ^1.7.5.

## [1.7.4] - 2026-08-06

### Changed

- No functional changes; requires `medienreaktor/neos-api` ^1.7.4.

## [1.7.3] - 2026-08-06

### Added

- Publishing all changes successfully sets off a burst of confetti.

### Changed

- **All Studio shortcuts are now ⌘⇧ (Ctrl+Shift on Windows and Linux) plus a
  letter.** These keys work everywhere, including while typing and on non-US
  keyboards. Toggle sidebar moves from ⌘B to ⌘⇧B, and Open settings moves from
  ⌘, to ⌘⇧O. ⌘/ no longer opens the shortcut overview; use `?`.
  Publish (⌘⇧P) and Reload preview (⌘⇧R) are unchanged.
- For plugin authors: a shortcut can declare `key: 'x'` instead of a full
  `combo`, which still works. A shortcut registered with `key` gets the ⌘⇧
  prefix automatically and also works inside inputs. Keys the browser always
  keeps for itself (`n`, `t`, `w`, `i`, `j`, `c`) are rejected with a console
  warning.

### Removed

- Arrow-key navigation in the document tree, content outliner, media folder
  tree and link picker tree.

## [1.7.2] - 2026-08-06

### Added

- **Shareable preview links.** The new Share button next to Review creates a
  link that shows the current page read-only, as a visitor would see it, to
  people without a login. This works for pages in private and shared
  workspaces too. Each link has a label and an expiry time (24 hours, 2 days
  or 7 days). The link is shown only once, when it is created. The dialog
  lists your active links and lets you revoke them. A link never shows more
  than the person who created it can see.
- `Medienreaktor.NeosStudio.previewLinks.defaultLifetime` (default `P2D`) and
  `Medienreaktor.NeosStudio.previewLinks.maxLifetime` (default `P7D`). No
  link can be valid for longer than `maxLifetime`.
- A database migration for the preview links table; run
  `./flow doctrine:migrate`.

### Security

- `/neos/studio/share/{token}` is open to anonymous visitors: the token in the
  URL is the only credential.
- Only a hash of each preview link's token is stored. Shared pages are sent
  with `noindex`, `no-store` and `Referrer-Policy: no-referrer`, and they
  never start a backend session. Invalid, expired and revoked links answer
  401.

## [1.7.1] - 2026-08-06

### Changed

- Media library cards and list rows fade in as more of them load, and each
  thumbnail fades in once its image has loaded.

### Fixed

- Expanding a folder in a tree no longer briefly replaces the folder's name
  with a loading placeholder.

## [1.7] - 2026-07-29

### Added

- **Task workflow: a task gets a workspace of its own, like a feature branch.**
  A task workspace is an ordinary shared Neos workspace. Its creator and the
  reviewers can manage it, the assignee can work in it, and editors who are not
  involved don't see it.
- **Tasks board**, a new panel with Open, In review and Done columns. Cards
  show the assignee, the comment count and whether the task has unpublished
  changes. Dragging a card to In review submits the task, and dragging it back
  to Open reopens it. Dropping it on Done opens the Review Changes dialog for
  the task's workspace. A task with nothing to publish is completed directly.
  Clicking a card opens a read-only view, and editing is a separate action.
- **Tasks in the workspace switcher**: they are grouped under Tasks, with
  badges colored by status. The switcher itself takes the color of the current
  task's status (purple for a plain collaborative workspace). A submenu offers
  Send to review, Complete and Reopen. "Add task workspace…" creates a task and
  switches to it right away, which is also what happens when you create a task
  from the board.
- **Tasks complete themselves**: when everything in a task workspace has been
  published, the task is marked done and the people involved are notified, no
  matter where the publish was started.
- **Comments on tasks.** Anyone who can read the task workspace can join the
  discussion. Send to review can include a comment for the reviewers. New
  comments notify the creator, the assignee and earlier commenters.
- **Notifications**: a bell in the top bar collects assignments, review
  requests, reopened tasks, comments and completed tasks. Clicking one opens
  its task, and read notifications can be cleared. Other packages can send
  their own notifications through
  `Medienreaktor\NeosStudio\Service\NotificationService` (`notify()`,
  `notifyUsers()`, `notifyUsersWithRole()`).
- **Workspace decorators**, a new plugin registry (`workspaceDecorators`) for
  badges and groups in the workspace switcher and the Workspaces
  administration, based on a workspace's `extensions` data. The plugin API now
  also includes `apiFetch` and `ApiError`, for calling Studio's API with the
  signed-in user's token, and `presenceColor` and `presenceInitials`, for
  drawing avatars that match Studio's.
- API endpoints under `/api/tasks` and `/api/notifications`, protected by the
  same OAuth bearer tokens as the NeosApi.
- Database migrations for the notification, task and task comment tables
  (MySQL/MariaDB only); run `./flow doctrine:migrate`.
- Tasks complete through a hook registered on the content repository preset
  `default`; a content repository under another preset needs
  `Medienreaktor.NeosStudio:TaskWorkspaceLifecycle` registered there too.
- `Medienreaktor.NeosStudio.taskWorkflow.reviewerRole` names the reviewers
  (default `Neos.Neos:LivePublisher`). Editors get the privileges to read and
  work on tasks; approving a task is granted to `Neos.Neos:LivePublisher`.

### Changed

- The trees show placeholder rows shaped like the real rows while they load,
  rows fade in, and the expand arrow turns instead of switching icons.
- Requires `medienreaktor/neos-api` ^1.7, which provides the extension point
  that adds task data to workspaces in API responses.

### Removed

- The preview's reload and open-in-new-tab buttons. Reload the preview with
  ⌘⇧R (Ctrl+Shift+R).
- The "Just you" hint next to the workspace switcher. When nobody else is in
  the workspace, no avatars are shown.

## [1.6] - 2026-07-28

### Added

- **Styles from `styleDefinitions`.** The rich-text toolbars, inline and in
  the inspector, offer a styles picker that assigns CSS classes from the same
  `ui.inline.editorOptions.formatting.styleDefinitions` configuration the
  classic UI's CKEditor reads, so a site needs no Studio-specific keys. Block
  elements (`p`, `h2`, ...) become block styles, anything else an inline
  style. Only configured classes survive saving, so pasted markup cannot bring
  its own; malformed or unsupported definitions are dropped with a console
  warning. Inline, each entry previews itself in the site's own CSS.
- **Replace Asset is back in the media library**, from the asset details
  dialog and the asset context menu: a dropzone limited to the asset's type,
  the current file for comparison, upload progress, the option to keep the
  filename, and a note when the asset is in use. Cropped variants do not offer
  it.

### Changed

- The workspace switcher disables other base workspaces while the personal
  workspace has unpublished changes, with a hint to publish or discard first,
  instead of letting the rebase fail. The current base and the collaborative
  entries stay available.
- The small favicons are sharper.
- Requires `medienreaktor/neos-api` ^1.6, which can list deleted pages
  without their content elements and guards asset replacement.

### Fixed

- A property rendered inline (`Neos.Neos:Editable` without `block`) no longer
  accepts paragraphs, headings, lists or other block markup when it declares
  no editor options; Enter no longer splits it, and alignment and table
  buttons no longer appear where they had no effect.
- An empty inline-editable property no longer shows an extra empty line above
  its placeholder.

## [1.5.2] - 2026-07-28

### Changed

- The favicons show the new Neos Studio logo.

## [1.5.1] - 2026-07-28

### Changed

- **New Neos Studio logo** in the sidebar header.
- The Trash panel lists deleted pages only. It no longer reports a count of
  deleted content elements with advice to discard their changes, which was
  wrong for content inherited from the base workspace.

## [1.5] - 2026-07-27

### Added

- **Trash panel**: the deleted pages of the current workspace, newest first,
  with who deleted them and when. Restoring needs no confirmation unless
  deleted ancestors come back with the page. Opening an entry shows the page
  as it was, read-only, with a banner offering to restore it.
- **History panel**: the unpublished editing steps of the open page, newest
  first, as recorded since the workspace forked. Selecting a step inspects the
  node it changed. Collaborators' edits appear on their own.

### Changed

- **Deleting a node is a soft removal**, as in the classic Neos UI: the
  subtree is tagged `removed` and disappears for editors, but the deletion
  stays a pending change that can be reviewed, published or discarded per
  document, and discarding restores the node. The content repository removes
  it for good in live once the deletion is published.
- **Workspaces graph and change logs restyled.** Slimmer, monochrome
  workspace cards with a "HEAD" tab on the checked-out workspace instead of an
  "Editing" chip; the legend is gone. Changes are coloured consistently across
  the history, the graph and the review dialog: additions green, modifications
  blue, removals red, dimension variants purple. Tagging steps (hidden, shown,
  removed, restored) no longer fold out.
- The review dialog names the kind of change ("Properties changed",
  "References changed", "Renamed", "Moved", "Variant created") where it is
  unambiguous, and uses the same icons and selection look as the trees.
- The workspace history tells a deletion from hiding ("Removed" / "Restored"
  instead of "Visibility changed").
- Node Types cards show their text in white on dark cards.
- Requires `medienreaktor/neos-api` ^1.5, for the deleted-node opt-in and the
  subtree tag on the events feed.

### Fixed

- A deleted node can be reviewed, published and discarded per document. It
  used to show up as a raw identifier badged "changed", and publishing or
  discarding it failed.
- A panel added after the layout was stored (by an update or a plugin) joins
  the tab group of its siblings instead of opening a group of its own.
- The `dev-main` branch alias follows the current minor version; it had
  stayed at `1.0.x-dev`.

## [1.4] - 2026-07-24

### Changed

- **Requires `medienreaktor/neos-api` ^1.4.** That release unifies the API
  contract and is a breaking server change; Studio 1.4 and API 1.4 have to be
  updated together. A plugin calling the API directly must follow the same
  changes: `/nodetypes` and `/datasources` are now `/node-types` and
  `/data-sources`, node and variant responses are wrapped in `node` and
  `variants`, asset writes go to `/media/assets/neos/{id}`, tags and
  collections are added and removed as sub-resources, and no endpoint takes a
  `DELETE` body any more.

## [1.3] - 2026-07-23

### Added

- **Workspaces panel**: every workspace as a git-style branch off its base,
  with live as the trunk. Branches split off at their actual fork point, carry
  their pending changes as commit dots (one dot per editing step) and end in a
  card showing classification, change count and outdated or read-only state.
  Selecting a card highlights its publish path to live.
- **Checkout and Rebase on workspace cards.** "Checkout" moves the editing
  context into a personal or writable shared workspace; "Rebase" synchronizes
  the checked-out workspace with its base, or moves it onto another root or
  shared workspace. "Review changes" opens the review dialog for that
  workspace.
- **Branch history** in the Workspaces panel: a log of a branch's editing
  steps, each unfolding into per-property before/after diffs.
- **Net diff in the review dialog**: each document row unfolds into what
  publishing would actually apply, one block per changed node, so five edits
  of the same text read as one change.

### Changed

- Shorter topbar labels: "Publish all" and, in German, "Änderungen prüfen".
- Requires `medienreaktor/neos-api` ^1.3, for the pending-events and
  document-diff resources.

### Fixed

- Change counts on the Publish and Review buttons count distinct nodes, so a
  node changed in two dimensions no longer counts twice.

## [1.2.6] - 2026-07-22

### Added

- **Review any workspace.** A dedicated Review button in the topbar opens the
  review dialog with a source ("Changes in") and a target ("Publishing to");
  the pickers only offer a workspace and its base. Changes of a shared
  workspace can now be published to live without entering it collaboratively.
  Publishing requires the publish permission, discarding requires write access
  to the reviewed workspace.

### Changed

- The pending-changes count moves from the Publish button to the Review
  button; "Review changes" is no longer in the Publish menu.

## [1.2.5] - 2026-07-22

### Added

- **Keyboard shortcuts** with an overview dialog (Shift+?): toggle the sidebar
  (Mod+B), open settings (Ctrl+, on macOS, Mod+, elsewhere), publish all
  changes (Mod+Shift+P) and reload the preview (Mod+Shift+R). Plugins can
  register their own or override built-ins through `shortcuts` and
  `useKeyboardShortcut` on `window.NeosStudio`.

### Fixed

- Dragging a tab to the last position of its group lands there; in a group of
  two, the move did nothing.

## [1.2.4] - 2026-07-22

### Added

- **Node Types panel**: the content model as a pannable, zoomable graph next
  to the Media Library. Every node type is a card with its own and inherited
  properties and references, connected along its supertypes; selecting one
  highlights its inheritance chain, and a search finds and centres matches.
  The property sections are collapsible.

## [1.2.3] - 2026-07-22

### Added

- Panels can be hidden and shown again from the tab context menu, which also
  resets the layout to its default.
- The secondary dock can be resized; its width is remembered.

### Changed

- The toolbar adapts to narrow widths by hiding switcher labels and presence
  avatars.

## [1.2.2] - 2026-07-22

### Changed

- The secondary dock with the inspector collapses instead of disappearing
  while the Media Library or another main panel is showing, and can still be
  expanded there.

## [1.2.1] - 2026-07-22

### Fixed

- The sidebar header has the same height as the toolbar.

## [1.2] - 2026-07-22

### Added

- **Settings screens for users, sites and workspaces**, replacing the classic
  backend modules. Users: search, create, edit, reset passwords, activate,
  deactivate and delete, with self-lockout actions disabled. Sites: create,
  edit, take offline, put online and delete, with full domain management.
  Workspaces: create, edit, delete and manage access through role assignments.
  Each section is shown according to the corresponding classic module's
  privilege.
- **User menu** next to the logo: an initials avatar with a shortcut to the
  profile settings and a logout that also ends the Neos backend session.

### Changed

- A site that is not yet reachable in the current workspace says
  "(synchronize to access)" in the site switcher. Offline sites are no longer
  listed there.
- The German interface addresses editors informally ("Du") throughout.
- Requires `medienreaktor/neos-api` ^1.2, for the administration endpoints.

### Fixed

- Selecting a node whose node type uses numeric inspector group or tab ids no
  longer crashes the inspector.

## [1.1] - 2026-07-22

### Added

- **Collaborative editing (multiplayer).** Every shared workspace has a
  "Collaborative" entry in the workspace switcher that moves the editing
  context into that workspace, so changes are made directly in it together
  with everyone else working there. Personal pending changes stay untouched.
  Colleagues show up as avatars in the toolbar, as markers in the trees and as
  coloured outlines with name tags in the visual editor. Their content edits
  appear in place without reloading the page, and publishing, discarding or
  rebasing refreshes the view. It runs on plain HTTP polling; no WebSocket
  server is needed.
- Collaborative editing needs the presence and event feed endpoints of
  `medienreaktor/neos-api` 1.1. The Composer constraint still allows 1.0, so
  update the API package along with Studio.

## [1.0.1] - 2026-07-21

### Changed

- No changes; the tag points to the same commit as 1.0 and carries the
  GitHub release "1.0: First Release".

## [1.0] - 2026-07-21

### Added

- **A new editing UI for Neos 9**, a React single-page application served at
  `/neos/studio` and talking to Neos only through `medienreaktor/neos-api`.
  It needs no `Neos.Neos.Ui`, appears as "Neos Studio" above "Content" in the
  backend menu, and is where editors land after login.
- **Silent authentication.** Studio registers its own first-party OAuth client
  on first load; logged-in backend users get a token without a consent screen,
  and tokens are refreshed automatically.
- **Dockable panel system**: Visual Editor, Media Library, Documents, Outline,
  Create, Clipboard and Inspector are panels that can be docked, grouped as
  tabs, resized and collapsed. The layout is remembered.
- **Document tree and content outliner**, loading lazily and honouring the
  Neos `loadingDepth` settings, with node type icons, hidden states and
  pending-change markers. The documents panel searches by title and filters by
  node type.
- **Live preview with inline editing.** The page renders in an iframe through
  a Studio endpoint; elements are selected by clicking, with a handle for
  hiding, deleting and moving. Property changes re-render only the affected
  element where `reloadIfChanged` allows it.
- **Inline rich-text editing on TipTap 3**, with floating inline and block
  toolbars, tables and a shared Link Editor for links in the page and in the
  inspector.
- **Context menus and drag and drop**: copy, cut, paste, delete and hide on
  every node in the trees and the preview; constraint-aware moves in the
  trees; and a clipboard panel that survives navigation.
- **Node creation**: drag a node type from the Create panel into the preview,
  or use the insert dialog (before, inside, after), filtered by node type
  constraints.
- **Inspector** with tabs and groups from the node type schema and editors for
  text, text area, rich text, select boxes (also backed by data sources),
  references, assets, images with cropping, links, date and time, ranges,
  booleans, code, node type and URI path segment.
- **Inspector views and validation**: node info, column, table and time
  series views; the `Neos.Neos/Validation` validators with inline errors, tab
  badges and blocked saving; `ClientEval:` expressions for hidden properties
  and dynamic editor options.
- **Content dimensions**: a dimension switcher, shine-through indicators,
  one-click variant creation in the inspector and the preview, and a marker on
  properties that apply to all variants.
- **Media Library** with upload, asset details, tags and collections, usage
  information, context menus, and a picker mode for asset and image
  properties, including picking images directly in the preview.
- **Workspaces and publishing**: site and workspace switchers, a publish split
  button scoped to the current site, a review dialog, a Synchronize button for
  outdated workspaces and a conflict-resolution dialog for publish and sync.
- **Settings dialog** with self-service profile settings for every editor
  (name, email, password, interface language) and a read-only user list for
  administrators.
- **English and German interface**, translated through the Neos XLIFF
  infrastructure.
- **Plugin API.** Third-party packages register panels, inspector editors,
  views, validators, Link Editor tabs, modals and settings sections through
  observable registries on `window.NeosStudio`, with TypeScript declarations
  in `Resources/Private/StudioApi`. A plugin bundle is loaded through a single
  `Medienreaktor.NeosStudio.plugins` entry in `Settings.yaml`.

[Unreleased]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.19.0...HEAD
[1.19.0]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.18.1...1.19.0
[1.18.1]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.18.0...1.18.1
[1.18.0]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.17.15...1.18.0
[1.17.15]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.17.14...1.17.15
[1.17.14]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.17.13...1.17.14
[1.17.13]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.17.12...1.17.13
[1.17.12]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.17.11...1.17.12
[1.17.11]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.17.10...1.17.11
[1.17.10]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.17.9...1.17.10
[1.17.9]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.17.8...1.17.9
[1.17.8]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.17.7...1.17.8
[1.17.7]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.17.6...1.17.7
[1.17.6]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.17.5...1.17.6
[1.17.5]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.17.4...1.17.5
[1.17.4]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.17.3...1.17.4
[1.17.3]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.17.2...1.17.3
[1.17.2]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.17.1...1.17.2
[1.17.1]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.17.0...1.17.1
[1.17.0]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.16.2...1.17.0
[1.16.2]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.16.1...1.16.2
[1.16.1]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.16.0...1.16.1
[1.16.0]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.15.0...1.16.0
[1.15.0]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.14.3...1.15.0
[1.14.3]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.14.2...1.14.3
[1.14.2]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.14.1...1.14.2
[1.14.1]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.14.0...1.14.1
[1.14.0]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.13.0...1.14.0
[1.13.0]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.12.1...1.13.0
[1.12.1]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.12.0...1.12.1
[1.12.0]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.11.2...1.12.0
[1.11.2]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.11.1...1.11.2
[1.11.1]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.11.0...1.11.1
[1.11.0]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.10.0...1.11.0
[1.10.0]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.9.10...1.10.0
[1.9.10]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.9.9...1.9.10
[1.9.9]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.9.8...1.9.9
[1.9.8]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.9.7...1.9.8
[1.9.7]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.9.6...1.9.7
[1.9.6]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.9.5...1.9.6
[1.9.5]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.9.4...1.9.5
[1.9.4]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.9.3...1.9.4
[1.9.3]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.9.2...1.9.3
[1.9.2]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.9.1...1.9.2
[1.9.1]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.9.0...1.9.1
[1.9.0]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.8.0...1.9.0
[1.8.0]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.7.6...1.8.0
[1.7.6]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.7.5...1.7.6
[1.7.5]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.7.4...1.7.5
[1.7.4]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.7.3...1.7.4
[1.7.3]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.7.2...1.7.3
[1.7.2]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.7.1...1.7.2
[1.7.1]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.7...1.7.1
[1.7]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.6...1.7
[1.6]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.5.2...1.6
[1.5.2]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.5.1...1.5.2
[1.5.1]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.5...1.5.1
[1.5]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.4...1.5
[1.4]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.3...1.4
[1.3]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.2.6...1.3
[1.2.6]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.2.5...1.2.6
[1.2.5]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.2.4...1.2.5
[1.2.4]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.2.3...1.2.4
[1.2.3]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.2.2...1.2.3
[1.2.2]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.2.1...1.2.2
[1.2.1]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.2...1.2.1
[1.2]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.1...1.2
[1.1]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.0.1...1.1
[1.0.1]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/compare/1.0...1.0.1
[1.0]: https://github.com/medienreaktor/Medienreaktor.NeosStudio/releases/tag/1.0
