# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

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
