# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Changed

- Modernized the Moodboard panel with a warm walnut-and-amber design language
  derived from the board's reference art direction: a hero-style active style
  guide, compact palette strip, sticky search/tag toolbar, uniform gallery
  cards with hover actions and an explicit selection check, and a sticky
  inspector footer.
- Removed the permanent drop zone: upload is available from the header and
  empty state, and a full-panel drag overlay appears only while dragging.
- Multi-select now uses a floating bottom command bar and appears only for two
  or more images; single-image actions live in the inspector.
- Upload confirmations became auto-dismissing status pills; the board palette
  row explains its copy-to-clipboard behaviour.
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
