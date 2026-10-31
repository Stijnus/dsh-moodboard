# Changelog

## 0.3.0 — 2026-10-29

### Added

- **Inspiration intake from links.** The new **Add from link** dialog captures
  public page URLs (Open Graph/Twitter preview image, title, author, site,
  description, canonical URL) and direct image URLs, with source links kept on
  every reference. New Host endpoints: `GET /moodboard/api/sources` and
  `POST /moodboard/api/import` (`urls`, `paths`, or `source` + `query`).
- **Mobbin and Are.na discovery.** Mobbin screens can be searched and imported
  through the official REST API (`MOBBIN_API_KEY`, Team/Enterprise; image URLs
  are downloaded immediately because they expire). Are.na public search works
  without a key. Provider names, platforms, app names and source URLs become
  tags/notes.
- **Browser-MCP bridge.** The `moodboard` tool's new `import` action accepts
  absolute local screenshot paths, so a Chrome DevTools MCP or Playwright MCP
  capture of a logged-in/bot-protected site (Dribbble, Mobbin web UI) can be
  added without manual upload.
- **Reference-to-component workflow.** New `moodboard` tool actions `sources`
  and `workflow`, a `moodboard:inspiration-workflow` system-prompt section, a
  copyable workflow in the panel, and `docs/INSPIRATION-WORKFLOW.md` covering
  collect → curate → extract → translate → build → verify → record, plus the
  source matrix and browser-MCP setup.
- **SSRF-safe source fetching in a dependency-free module.** `sources.js`
  validates http(s) URLs, blocks loopback/private hosts and redirect escapes,
  caps page/image sizes, applies timeouts, and never logs secrets or bytes.

### Changed

- `sources.js` joins the published bundle (`package.json` `files`).
- The panel header and empty state offer **Add from link**; the import dialog
  supports Link and Discover modes with per-item results and silent board
  refresh.
- The import dialog now uses the panel's selected-chip treatment for its mode
  switch, standard 32px action buttons, and a compact Results field so it
  matches the rest of the panel at both widths and themes.
- README and the build contract document the new routes, actions and data file;
  the panel screenshot is refreshed and the dialog has its own screenshot.

### Fixed

- Are.na text blocks no longer consume the requested image-block limit; the
  adapter now takes the first `limit` blocks that actually carry an image.
- `discoverReferences` accepts only `mobbin` and `arena`; a `web` (or any other
  catalog id) is rejected with `invalid-argument` before any request is made,
  instead of silently falling through to an Are.na search.

## 0.2.11 — 2026-10-28

### Changed

- Replaced the timed, one-time "star the suite" overlay prompt with a quiet,
  user-initiated star link in the Moodboard panel header. It never interrupts
  or auto-opens; it links to the Stijnus DSH plugin suite on GitHub.

## 0.2.10 — 2026-10-28

### Added

- A one-time, dismissible "star the suite" prompt in the app overlay links to
  the five Stijnus plugin repositories. It shows at most once per browser and
  the whole suite shares the marker, so installing all five cannot stack five
  prompts.

## 0.2.9 — 2026-10-27

### Fixed

- The panel now picks up board writes made outside its own session — most
  importantly references the agent adds through `POST /moodboard/api/images` —
  instead of showing a stale board until the page or desktop app is reloaded.
  The client polls a cheap revision endpoint every few seconds while the
  document is visible and checks immediately on window focus, network recovery
  and visibility return; a changed revision (or board timestamp, so a Host
  reload is noticed too) re-reads `/api/state`, and that refresh stays silent
  (no loading skeleton, no error banner while a board is loaded). Uploads and
  mutations in flight are never interrupted by a poll, a hung revision read is
  aborted after 5 s, and the poll defers to any full refresh already running.
- A poll that recovers a failed activation read clears the stale "could not
  load" banner instead of leaving the loaded board under it.
- Added `GET /moodboard/api/revision` (`{ ok, revision, updatedAt, images }`)
  for change detection; `GET /moodboard/api/state` now carries the same
  process-local monotonic `revision` alongside `board`. Reads never bump it, and
  every committed write does.

### Added

- Regression tests for the revision endpoint (external upload, patch and delete
  bump it; reads do not; the activation load sets a positive revision) and for
  the client sync loop (unchanged revisions and timestamps do not re-read, the
  poll path never shows the loading state, hidden documents do not poll,
  foreground events check at once, transient revision- and state-read failures
  stay invisible once a board is loaded, the revision read is aborted at its
  deadline and the next poll still works, a poll never supersedes an in-flight
  refresh, auto-recovery clears the load error, and disposal stops the
  timer/listeners), plus an end-to-end test driving a real loopback HTTP Host
  while the client polls — the exact reported flow.

## 0.2.8 — 2026-10-25

### Changed

- Advertise a catalog category so plugin markets place it under UI instead of guessing.

## 0.2.7 — 2026-10-25

### Changed

- Renamed the npm package from `@stijnus/dsh-moodboard` to `dsh-moodboard`, in
  line with the other DSH plugins. The bundle row, client plugin id and install
  instructions changed with it. `@stijnus/dsh-moodboard` no longer resolves on
  npm (it was unpublished, so old pins return 404 — install `dsh-moodboard`).
  No behaviour changed.

## 0.2.6 — 2026-10-25

### Fixed

- Image URLs now carry the attachment revision (`?v=<attachmentId>`). A request
  for a revision that is no longer on the board answers 404 instead of serving
  different bytes, and only versioned responses are cached `immutable`;
  unversioned requests answer `no-store`.
- The gallery revokes an object URL when a board refresh replaces or removes the
  image, and discards an in-flight load that resolves after the image left the
  board, so a stale thumbnail can no longer repopulate the cache.
- Switching references no longer shows the previous image while the new one
  decodes.
- The metadata editor compares against the last loaded revision, so a server
  update is adopted while genuinely unsaved edits keep Save offered.
- Re-mounting the plugin after disposal no longer leaves the client disposed.

### Changed

- `get` returns complete notes, tags and source URL. `active` and `query`
  overviews now include reference IDs and point at `get`/`list` for full
  metadata; `list` lines carry the id.

### Added

- Behavior tests for revision-scoped image URLs, complete `get` metadata, client
  cache release, in-flight cancellation and the editor dirty baseline, plus two
  reference fixtures and `docs/LIVE-TEST.md` recording the manual verification.

## 0.2.5 — 2026-10-25

- Block reads and writes after an initial board load failure instead of replacing existing data with an empty board.
- Require a successful recovery backup before replacing corrupt board data.
- Add behavior tests for persisted image metadata, pins, model image blocks and failed-load protection.

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.2.4] - 2026-10-25

### Removed

- Board palette strip: display-only dominant-color extraction had no agent or
  API integration and duplicated what the references already convey. Palette
  data is planned to return with the 0.3 token-export work.

### Changed

- Modernized the Moodboard panel with harness-native styling: surfaces,
  borders, text, buttons, inputs and links now come from DSH theme tokens
  (light and dark), and the only custom colour is a low-saturation warm tint
  used sparingly on the active style-guide surface and pinned affordances.
  The panel gains a hero-style active style guide, sticky search/tag toolbar,
  uniform gallery cards with hover actions and an explicit selection check,
  and a sticky inspector footer.
- Removed the permanent drop zone: upload is available from the header and
  empty state, and a full-panel drag overlay appears only while dragging.
- Multi-select now uses a floating bottom command bar and appears only for two
  or more images; single-image actions live in the inspector.
- Upload confirmations became auto-dismissing status pills.
- The inspector turns into a dismissible bottom sheet on narrow screens, and
  card actions collapse to icon-only controls on touch.
- Improved light-theme contrast for success/warning text, form boundaries and
  the source link; added reduced-motion fallbacks for all new transitions.

### Added

- Lightbox position counter, inline pin toggle and an "Edit details" action.
- Clickable active style-guide thumbnails that open the reference lightbox.
- Skeleton gallery while the board loads and a richer empty state with one
  primary "Add images" action plus clipboard paste.
- `Merge tags` naming for the tag manager (it merges into a new tag name).

## [0.2.3] - 2026-10-25

### Added

- Select all visible images (⌘/Ctrl+A) and invert the selection
  (⌘/Ctrl+Shift+A or the bulk bar's Invert action), with toolbar buttons and
  live status announcements; shortcuts stay inert in text fields, dialogs and
  the lightbox.
- Gallery images load lazily near the viewport and the grid renders in pages
  (`GALLERY_PAGE_SIZE`, auto-loading near the bottom), so large boards no
  longer fetch every thumbnail up front.
- Keyboard ordering: `Alt+←/→` on a focused card moves it (focus follows the
  card after the refresh), `/` focuses the gallery search, and `?` opens a
  localized shortcuts dialog.
- Drag edge cases: a drag-time drop zone moves a card to the end, Escape
  cancels an in-flight drag, and Move left/right buttons in the details panel
  give a touch/accessible alternative to drag-and-drop.

## [0.2.2] - 2026-10-25

### Added

- Tag autocomplete in the metadata and bulk tag inputs.
- Tag manager: rename or merge a tag across the whole board via
  `POST /moodboard/api/tags/merge`, with per-tag counts.
- Copy/paste tags, notes and source URL between references.
- Board palette strip extracted client-side from the references; click a
  swatch to copy its hex.

## [0.2.1] - 2026-10-25

### Added

- Gallery search across name, tags, notes and source URL, combinable with the
  tag filter; drag reordering pauses while a filter or search is active.
- Reference lightbox: full-size view with previous/next navigation, arrow keys,
  focus trapping and focus restore, tags, notes and source link.

## [0.2.0] - 2026-10-25

### Added

- Clipboard paste of images (⌘V/Ctrl+V) and a toolbar Paste button.
- Drag-to-reorder gallery cards with a persisted manual order.
- Multi-select (Shift/Cmd/Ctrl-click) with a bulk toolbar: pin, unpin, add tag,
  remove.
- Host endpoints `POST /moodboard/api/images/reorder` and
  `POST /moodboard/api/images/bulk`.

### Changed

- Gallery order is now the manual board order instead of pinned-first; pinned
  references remain in the active style-guide strip and keep their badge.

## [0.1.2] - 2026-10-25

### Changed

- README: npm/CI/provenance badges and a trusted-publishing and provenance
  section. Metadata-only release; no runtime or API changes.

## [0.1.1] - 2026-10-25

### Changed

- First release published through npm trusted publishing (GitHub Actions OIDC)
  with a provenance attestation. No runtime behaviour changes from 0.1.0.

## [0.1.0] - 2026-10-25

### Added

- Moodboard panel in the DeepSeek Harness Web UI: sidebar entry, gallery of
  thumbnails, drag-and-drop upload, tag filter, active style-guide strip.
- Per-image metadata editor: name, tags, notes, source URL, pin switch,
  replace and inline-confirmed remove.
- Durable board persistence in `<DSH_HOME>/moodboard/board.json` with atomic
  writes and corrupt-file recovery; images in the harness attachment store.
- Agent tool `moodboard` with `active`, `query`, `list`, `get`, `brief`; active
  and query responses carry real image content blocks plus tags, notes and
  sources.
- System-prompt style-guide section and a composer control that inserts the
  moodboard directive into the draft without sending.
- Owner-authenticated HTTP API for state, upload, patch, replace, delete,
  active guide, tag query, health and raw image bytes.
- English and Chinese UI copy; theme-token styling; smoke test suite and
  tag-driven npm release workflow.
