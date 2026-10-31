# dsh-moodboard

[English](./README.md) · [中文](./README.zh-CN.md)

[![npm version](https://img.shields.io/npm/v/dsh-moodboard.svg)](https://www.npmjs.com/package/dsh-moodboard)
[![provenance: signed](https://img.shields.io/badge/provenance-signed-brightgreen)](https://www.npmjs.com/package/dsh-moodboard)
[![test](https://github.com/Stijnus/dsh-moodboard/actions/workflows/test.yml/badge.svg)](https://github.com/Stijnus/dsh-moodboard/actions/workflows/test.yml)
[![release](https://github.com/Stijnus/dsh-moodboard/actions/workflows/release.yml/badge.svg)](https://github.com/Stijnus/dsh-moodboard/actions/workflows/release.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A **visual reference moodboard** for DeepSeek Harness. Collect screenshots and
inspiration images in the Web UI, tag and annotate them, pin the ones that
define your app's visual language, and let the agent read that style guide
before it generates or restyles UI.

## Preview

The screenshot below shows the plugin panel. For a local walkthrough after installation:

1. Open **Moodboard** from the sidebar. Add a screenshot by drag-and-drop, clipboard paste or **Add images**, or pull one from a URL with **Add from link** → **From links** / **Discover**.
2. Give it a tag and a note describing what to borrow (and what not to copy), then pin the references that define the direction.
3. Use the composer’s **Moodboard** button to add the reference directive to your draft. Review and send it when ready.

[Install](#quick-start) · [Requirements](#requirements) · [Agent API](#agent-api) · [Limits](#limits)

![Moodboard panel: the pinned active style guide the agent reads, and the tagged reference gallery](https://raw.githubusercontent.com/Stijnus/dsh-moodboard/main/docs/panel.jpg)

## Quick start

```sh
dsh plugin --profile web add dsh-moodboard
```

Restart the Harness (or refresh the Web UI). It adds a **Moodboard** entry to the sidebar.

<sub>More from this suite: [Moodboard](https://github.com/Stijnus/dsh-moodboard) · [Composer Predictions](https://github.com/Stijnus/dsh-composer-predictions) · [Move to Workspace](https://github.com/Stijnus/dsh-move-to-workspace) · [Workspace Status](https://github.com/Stijnus/dsh-workspace-status) · [Prompt Rewrite](https://github.com/Stijnus/dsh-prompt-optimizer)</sub>

<sub>⭐ If this saves you a step, a star helps the next DSH user find it.</sub>

## What you get

- **Moodboard panel** in the Web UI (sidebar icon): drag-and-drop, clipboard
  paste or file-picker upload; gallery of thumbnails with drag-to-reorder and
  multi-select bulk actions; tag filter; and an active style-guide strip.
- **Live sync**: references the agent uploads through the HTTP API (or edits
  made from another window) show up within a few seconds — no page reload and
  no desktop app restart. The panel fetches the board on activation, then a
  cheap revision poll plus window focus / visibility checks keep it current.
- **Modern, theme-aware UI**: harness-native styling built entirely on DSH
  theme tokens (surfaces, borders, text, buttons, inputs, links), with warm
  accents kept to a subtle tint on the active style-guide surface and pinned
  affordances. Includes a hero-style active style guide, sticky search/filter
  toolbar, icon-only card actions with hover affordances, a floating
  multi-select command bar, a sticky inspector footer and a bottom-sheet
  inspector on narrow screens. Motion honours `prefers-reduced-motion`; focus
  rings, live regions and labelled controls are preserved.
- **Capture**: drop files from Finder, paste images with ⌘V/Ctrl+V, use the
  Paste / Add images buttons, or pull a reference from a URL, Mobbin or Are.na
  with **Add from link**. Uploaded images are downscaled and stored durably.
- **Organize**: drag cards to set the gallery order, Shift/Cmd-click to select
  several, then pin, unpin, tag or remove them in one action.
- **Find & inspect**: search by name, tags, notes or source (combinable with
  the tag filter), and open any reference in a full-size lightbox with
  previous/next navigation and keyboard support.
- **Keyboard & accessibility**: `?` opens the shortcuts list, `/` focuses
  search, `⌘A` selects all, `⌘⇧A` inverts, `Alt+←/→` reorders a focused card;
  controls keep visible focus rings, dialogs are labelled and keyboard-trapped,
  and selection/filter changes are announced through live status regions.
- **Tag smartness**: autocomplete from the tags already on the board, and a
  tag manager that renames or merges a tag across every reference (with
  per-tag counts).
- **Reuse**: copy tags/notes/source from one reference and paste them into
  another.
- **Per-image metadata**: tags, notes, source URL, name — editable in a
  metadata panel, with pin / replace / remove actions.
- **Active style guide**: pin one or more references. The agent treats pinned
  images as the source of truth for typography, color, spacing, radius,
  iconography and component styling.
- **Agent integration**:
  - `moodboard` tool with `active` / `query` / `list` / `get` / `brief`
    actions. `active` and `query` return the reference images themselves as
    image content blocks, so the model analyses the actual pixels, plus tags,
    notes and source URLs.
  - A system-prompt section tells the agent the moodboard exists and to load it
    before designing UI.
  - A compact **Moodboard** button in the composer inserts a directive into the
    draft that points the agent at the pinned references (it never sends).
- **Persistence**: metadata survives restarts in
  `<DSH_HOME>/moodboard/board.json`; image bytes live in the durable
  attachment store (`<DSH_HOME>/attachments/v1`). Survives sessions, reloads
  and restarts.

## Pull inspiration automatically

The panel's **Add from link** dialog has two intakes:

- **Link** — paste up to 20 public page URLs. The Host fetches each page and
  stores its Open Graph/Twitter preview image with the title, author, site,
  description and canonical source URL. Direct image URLs work too.
- **Discover** — search **Mobbin** screens (official REST API, Team/Enterprise
  key) or **Are.na** (public, no key) and add the results in one action. Mobbin
  image URLs expire, so the plugin downloads the bytes immediately; source
  links and app names are preserved as tags/notes.

![Add from link dialog: From links and Discover modes, Mobbin setup hint, tags and pin toggle](https://raw.githubusercontent.com/Stijnus/dsh-moodboard/main/docs/import-dialog.jpg)

The agent has the same abilities through the `moodboard` tool:
`action: "import"` with `urls`, `paths` (local screenshots from a browser MCP)
or `source` + `query`; `action: "sources"` lists what is configured; and
`action: "workflow"` returns the reference-to-component method.

Configure Mobbin with `MOBBIN_API_KEY` or
`~/.dsh/moodboard/sources.json` (`{ "mobbinApiKey": "…" }`). Dribbble blocks
server-side page fetches, so capture it with a browser MCP or upload the
screenshot — see [docs/INSPIRATION-WORKFLOW.md](docs/INSPIRATION-WORKFLOW.md)
for the browser MCP setup, the source matrix and the designer-respect rules.

## From inspiration to components

The plugin ships the method as a prompt section and a copyable workflow, not
just a gallery:

1. **Collect** 5–10 references for the same job, with source links.
2. **Curate** with role tags (`layout`, `type`, `palette`, `component`,
   `motion`, `flow`) and pin the 2–4 that define the direction.
3. **Extract** borrow/avoid notes: structure, spacing rhythm, type scale, color
   roles, radius/elevation, icon style, motion — and what not to copy.
4. **Translate** into your own tokens and content for the page archetype.
5. **Build** one representative component per role, with states, dark mode,
   keyboard/focus, responsive behavior and reduced motion.
6. **Verify** at the same viewport: structure/rhythm, then type/color, then
   interaction; check contrast, hit targets, overflow and motion fallbacks.
7. **Record** the component and reuse the pinned references as the style guide.

Full guide: [docs/INSPIRATION-WORKFLOW.md](docs/INSPIRATION-WORKFLOW.md).

## Requirements

DeepSeek Harness `>=0.2.1-rc.3 <0.3.0-0` with the Web profile (the Host half
needs `attachments`, `tools`, `systemPrompt`, `webServer`, and `connection`;
the browser half needs the slots and locale services).

## Install

> **Renamed in 0.2.7.** This plugin publishes as `dsh-moodboard`. The earlier
> scoped name `@stijnus/dsh-moodboard` was unpublished, so pins to it now return
> 404 — install `dsh-moodboard` and remove the old entry from your profile.

Unpublished earlier name aside, installation is one command:

From npm once a release is published, through the Plugins page or
`plugin_manager install_bundle`:

```text
plugin_manager install_bundle target: "dsh-moodboard"
```

Manual equivalent (installs the package into a profile; the bundle still has to
be enabled through the Plugins page):

```bash
dsh plugin --profile <profile> add dsh-moodboard
```

Reload the Web UI if the sidebar icon does not appear immediately.

## Development

```bash
git clone https://github.com/Stijnus/dsh-moodboard.git
cd dsh-moodboard
npm test              # syntax checks + node:test smoke suite
npm run pack:check    # verify the published tarball file list
```

Install a local checkout into a profile for manual testing:

```text
plugin_manager install_bundle target: "/absolute/path/to/dsh-moodboard"
```

The current build contract for the Host and Client halves is
[docs/CONTRACT.md](docs/CONTRACT.md).

## Agent API

### Tool `moodboard`

| action | meaning |
|---|---|
| `active` (default) | pinned style guide, or the whole board when nothing is pinned. Returns metadata **and** the images themselves. |
| `query` | filter by tag(s): `tags: ["dark","typography"]`, `match: "any" \| "all"`. Returns matching images. |
| `list` | metadata for every image, no image bytes (cheap overview). |
| `get` | one image by `id`, with complete notes, tags and source URL. |
| `brief` | text-only style brief (names, tags, notes, sources). |
| `import` | add references: `urls` (link capture), `paths` (local screenshots), or `source` + `query` (Mobbin/Are.na discovery). Optional `tags`, `notes`, `pinned`. |
| `sources` | list the configured inspiration sources and the local config path. |
| `workflow` | the reference-to-component method plus the active brief. |

`includeImages: false` suppresses image content blocks. Image content is capped
at 6 per call. `active` and `query` return abbreviated overviews with reference
IDs; use `get` for complete metadata, or `list` to find all reference IDs.
`import` returns imported images, `duplicates` (already on the board) and
per-item `failures`; a failed item never fails the whole batch.

### HTTP endpoints

The Host half serves one authenticated prefix route `/moodboard` (owner
session cookie required, same origin as the Web UI). The agent normally uses
the tool; these endpoints exist for the panel and for programmatic reads:

| Method + path | Purpose |
|---|---|
| `GET /moodboard/api/state` | full board + guide summary |
| `POST /moodboard/api/images` | upload `{ data, mediaType, name?, tags?, notes?, sourceUrl? }` |
| `PATCH /moodboard/api/images/<id>` | update `name`, `tags`, `notes`, `sourceUrl`, `pinned`, `order` |
| `POST /moodboard/api/images/<id>/replace` | replace bytes, keep metadata |
| `DELETE /moodboard/api/images/<id>` | remove |
| `POST /moodboard/api/images/reorder` | set the complete gallery order `{ ids: [...] }` |
| `POST /moodboard/api/images/bulk` | bulk `{ ids, pinned?, addTags?, removeTags?, delete? }` |
| `POST /moodboard/api/tags/merge` | rename/merge `{ from, to }` across the board |
| `GET /moodboard/api/active` | active guide with tags/notes/sources/brief |
| `GET /moodboard/api/query?tag=…&match=any` | tag lookup |
| `GET /moodboard/api/health` | liveness + image count |
| `GET /moodboard/api/revision` | cheap change detector for the open panel `{ revision, updatedAt, images }` |
| `GET /moodboard/api/sources` | configured inspiration sources, workflow text, config path |
| `POST /moodboard/api/import` | `{ urls }` / `{ paths }` / `{ source, query, platform?, limit? }` + `tags?`, `notes?`, `pinned?`; returns `{ imported, duplicates, failures }` |
| `GET /moodboard/image/<id>?v=<attachmentId>` | normalized image bytes for that revision |

All JSON responses use `{ ok: true, … }` or
`{ ok: false, error: { code, message } }`. `GET /moodboard/api/state` carries
the same process-local `revision` as `/api/revision`; the panel compares it (and
the board timestamp, so a Host reload is noticed too) with what it last applied
and only re-reads the full board when either changed.

## Data

- Metadata: `<DSH_HOME>/moodboard/board.json` (atomic writes; corrupt files are
  backed up as `board.corrupt-<timestamp>.json` and the board starts empty).
- Images: content-addressed in the harness attachment store. They are
  normalized on upload (WebP/JPEG, max edge 1600 px from the UI) and never
  deleted automatically; removing a board entry only removes the reference.
- Source config: `<DSH_HOME>/moodboard/sources.json` (optional; currently
  `{ "mobbinApiKey": "…" }`). The environment variable `MOBBIN_API_KEY` wins.
  The file is re-read on every import.

## Visual language

Plugin chrome uses Harness theme tokens (`--dsw-alias-*`) so the panel follows
light/dark switching. Image thumbnails are the user's own artwork.

## Limits

- Up to 200 images, 20 tags per image (48 chars each), 4000-char notes.
- Uploads are re-encoded client-side (max edge 1600 px, q 0.85) before upload.
- Imports: up to 20 links/paths per call, 12 discoveries per call; remote pages
  are capped at 4 MiB and remote images at 12 MiB; only http(s) URLs, with
  private/loopback hosts blocked.
- The HTTP endpoints are owner-authenticated for same-origin/browser callers.
  A bash/curl caller has no session cookie — use the `moodboard` tool instead.

## Releases and provenance

Releases are tag-driven and published from GitHub Actions using npm
**trusted publishing** (OIDC). No long-lived npm token is stored in the
repository: npm only accepts a publish from this repository's `release.yml`
workflow at a tagged commit, and the short-lived credential minted for that run
cannot be reused elsewhere.

Every release from `0.1.1` onward is published with a provenance attestation
that binds the tarball to this repository, the workflow file, and the commit.
The npm package page shows the **Provenance** badge for those versions.
`0.1.0` was published manually before the publisher was configured, so it has
no attestation.

Verify a release:

```bash
npm view dsh-moodboard@<version> dist.attestations
npm view dsh-moodboard@<version> dist.integrity
```

The attestation URL resolves to the signed in-toto statement; the matching
Sigstore transparency-log entry is printed in the release workflow log. The
one-time publisher setup, tag/release steps, and post-publish checks are in
[RELEASING.md](RELEASING.md); version history is in
[CHANGELOG.md](CHANGELOG.md).

## License

MIT. Icon and panel screenshot: original artwork for this plugin.

If the saved board cannot be read or its recovery backup cannot be written, the plugin reports a storage error and blocks changes. Correct the storage problem and reload the plugin; existing board data is retained.
