# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

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
