> **Packaging note.** This bundle is published as `dsh-moodboard`.
> The client loader id and the patch row `name` use that scoped package name;
> the Loader row id remains `moodboard`.

# dsh-moodboard — build contract

This file is the single source of truth shared by the Host and Client halves.
Do not edit it without asking the Lead. File ownership is strict:

| File | Owner |
|---|---|
| `index.js` (Host) | host-dev |
| `client.js` (Client UI) | client-dev |
| `package.json`, `cordis.patch.yml`, `locale/*`, `icon.svg`, `README.md`, `CONTRACT.md` | Lead |

Target: DSH `0.2.1-rc.3`, Web profile. The bundle is installed with
`plugin_manager install_bundle` from this directory, so it is linked into
`~/.dsh/profiles/<profile>/node_modules/dsh-moodboard`.

Hard constraints:

- **Host `index.js`**: plain ESM, only `node:` builtin imports. No third-party
  packages (`zod`, `@deepseek-ai/*` are NOT resolvable from this bundle).
- **Client `client.js`**: plain browser JavaScript, no imports of any kind
  (no `import`, no `require` except `require('react')` and
  `require('react/jsx-runtime')` if needed). No JSX — use
  `React.createElement`. The module must start with
  `window.__ModuleLoader__.load({ id: 'dsh-moodboard', factory(require) { ... } })`
  and the factory must return `{ inject, apply }`.
- No build step. Files are served/loaded as-is (like `prompt-optimizer/client.js`).
- Do not read or write the profile directory from code except the documented
  moodboard data dir; do not touch other plugins.

## Verified Harness facts

### Host plugin skeleton

```js
export const name = 'moodboard'
export const inject = ['attachments', 'tools', 'systemPrompt', 'webServer', 'connection']

export function apply(ctx) {
  // register everything through ctx.effect / ctx.on and return the cleanup
}
```

The exported `inject` names must exist in the Web profile: `attachments`
(`@deepseek-ai/dsh-attachment`), `tools`, `systemPrompt`, `webServer`,
`connection` all do.

### Durable image bytes: the attachment service

`ctx.attachments.saveImage({ data: Uint8Array, mediaType, name })`
→ `imageLimits`, `saveImages`, `readImage`, `imageHostPath`.
`mediaType` is one of `image/png | image/jpeg | image/webp | image/gif`.
The returned **normalized** ref is:

```ts
{ attachmentId: string, mediaType, bytes: number, width: number, height: number,
  name?: string, originalDimensions?: { width, height } }
```

Store that ref object verbatim in the board JSON. Read bytes back with
`await ctx.attachments.readImage(ref)` → `{ ref, data: Uint8Array }`.
Images are content-addressed below `<DSH_HOME>/attachments/v1`, never deleted
automatically, and survive restarts. `saveImage` validates and normalizes
(may convert to WebP/JPEG); never assume the original media type survives.

### Host HTTP routes

```js
ctx.effect(() => ctx.webServer.register({
  kind: 'prefix',                 // 'exact' | 'prefix'
  path: '/moodboard',
  handler: (req, res) => { /* node:http IncomingMessage/ServerResponse */ },
}))
```

A route handler must do its own auth:

```js
const admission = ctx.connection.admit(req)
if ('rejection' in admission) return send(res, admission.rejection, errorBody('unauthorized'))
if (admission.peer.principal.kind !== 'owner') return send(res, 403, errorBody('forbidden'))
```

Route registration has no per-route body parsing; read the request body
yourself with a bounded `data`/`end` reader.

### Agent tool (raw register, no `defineTool`)

`ctx.tools.register(definition)` returns a disposer. A raw definition:

```js
{
  name: 'moodboard',
  description: '…',
  parameters: { type: 'object', additionalProperties: false, properties: { … }, required: [] },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { … } },
    render(args, value) { return [ { type: 'text', text: '…' },
      { type: 'image', attachment: { attachmentId, mediaType, bytes, width, height } } ] },
    presentationMeta(args, value) { /* optional */ },
  },
  async execute(args, exec) { return value },
  presentCall(args) { return { card: 'generic', title: '…', kind: 'read' } },
  isConcurrencySafe: () => true,
}
```

`render` is what the model receives; `{type:'image', attachment: ref}` makes
the reference image itself visible to the model — verified in the shipped
`read_image` tool. `execute` must return a JSON value matching `output.schema`.
Tool args are untrusted: validate them all in `execute`.

### System prompt section

```js
ctx.effect(() => ctx.systemPrompt.section({
  name: 'moodboard:style-guide',
  order: 2450,                       // between goal (2400) and workflow (2600)
  text: () => '…',                   // dynamic, re-read at each assembly
}))
```

Return `''` when the board has no images (empty sections are dropped).
Never register a `complete: true` section.

### Persistence

Board metadata JSON at:

```
<DSH_HOME>/moodboard/board.json
```

`DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')`.
Create the directory with mode `0o700`. Atomic write: write
`board.json.tmp-<pid>-<rand>` then `rename` over `board.json`. Serialize
mutations through one promise chain (no interleaved writes). On load:
missing file → empty board; malformed file → copy it to
`board.corrupt-<timestamp>.json`, log a warning, start empty (never crash the
Host). Load lazily at plugin activation; the in-memory board is the read model.

### Client slot registration (verified)

Returned plugin shape: `{ inject: ['slots', 'locale'], apply(ctx) {} }`.

```js
ctx.effect(() => ctx.locale.register('moodboard', { en: {…}, zh: {…} }))
const t = ctx.locale.bind('moodboard')

// sidebar icon: props = { size, active }
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
  { name: 'sidebar.panellist', id: 'moodboard', order: 20, label: () => t('panel') },
  MoodboardIcon,
))

// panel page: keyed `main` slot; the sidebar selects the panel by the same id
ctx.slots.inject('main', () => ctx.slots.register(
  { name: 'main', key: 'moodboard', locale: 'moodboard' },
  MoodboardPage,
))

// optional composer control: props include { sessionId, useInput, inputActions }
ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
  { name: 'conversation.input.right', id: 'moodboard', order: 15, label: () => t('reference') },
  ReferenceButton,
))
```

`inputActions` truth (verified in the shipped composer):
`insertText(text, span)` where `span = inputActions.captureInsertion()`,
returns `false` when the caret revision moved; `setDraft(text)` fallback.
`props.useInput(state => state?.draft ?? '')` reads the draft.

### Theme tokens (only these)

`--dsw-alias-bg-base`, `--dsw-alias-bg-layer-1`, `--dsw-alias-bg-layer-2`,
`--dsw-alias-bg-overlay`, `--dsw-alias-border-l1`, `--dsw-alias-border-l2`,
`--dsw-alias-brand-primary`, `--dsw-alias-label-primary`,
`--dsw-alias-label-secondary`, `--dsw-alias-state-error-primary`,
`--dsw-alias-state-idle-primary`, `--dsw-alias-state-success-primary`,
`--dsw-alias-state-warn-primary`, `--dsw-specific-sidebar-fill`.

Visible text must come from the locale dictionaries (en + zh). Inline styles
are fine; component-local `<style>` elements are fine (prefix classes with
`dsh-mb-`). Never replace the app root, never write DOM outside the component.

## Data model

`board.json`:

```json
{
  "version": 1,
  "updatedAt": "ISO-8601 or null",
  "nextOrder": 3,
  "images": [
    {
      "id": "mb_ab12cd34ef56",
      "name": "dashboard-dark.png",
      "attachment": { "attachmentId": "…", "mediaType": "image/webp",
                      "bytes": 12345, "width": 1600, "height": 900,
                      "name": "dashboard-dark.png" },
      "tags": ["dark", "typography"],
      "notes": "JetBrains Mono headings, 8px radius, warm greys.",
      "sourceUrl": "https://dribbble.com/…",
      "pinned": true,
      "order": 0,
      "createdAt": "ISO-8601",
      "updatedAt": "ISO-8601"
    }
  ]
}
```

Rules:

- `id`: `mb_` + 12 lowercase hex chars, random (`crypto.randomUUID()` slice or
  `randomBytes`).
- `tags`: trimmed, non-empty strings, de-duplicated case-insensitively
  (store the first spelling), max 20 tags, each ≤ 48 chars.
- `notes` ≤ 4000 chars; `sourceUrl` ≤ 2000 chars and must be `http:`/`https:`
  or stored as `""`; `name` ≤ 200 chars (fallback `image`).
- Max 200 images per board.
- `pinned` = membership in the active style guide. Multiple pinned images are
  allowed. `order` ascending is gallery order.
- Sorting everywhere: pinned first, then `order`, then `createdAt`.

## HTTP API (Host)

One `prefix` route `/moodboard`, one handler dispatching by
method + `pathname`. Every response is JSON unless noted. Success:
`{ "ok": true, … }`; failure: `{ "ok": false, "error": { "code", "message" } }`.
Codes: `unauthorized` (401), `forbidden` (403), `not-found` (404),
`invalid-body` (400), `invalid-query` (400), `invalid-image` (400),
`unsupported-media-type` (415), `image-too-large` (413), `board-full` (409),
`storage-failed` (500), `method-not-allowed` (405).

| Method + path | Body / query | Success |
|---|---|---|
| `GET /moodboard/api/state` | — | `{ ok, revision, board: BoardView }` |
| `POST /moodboard/api/images` | `{ data, mediaType, name?, tags?, notes?, sourceUrl? }` | `{ ok, image: ImageView }` |
| `PATCH /moodboard/api/images/<id>` | any of `{ name, tags, notes, sourceUrl, pinned, order }` | `{ ok, image }` |
| `POST /moodboard/api/images/<id>/replace` | `{ data, mediaType, name? }` | `{ ok, image }` |
| `DELETE /moodboard/api/images/<id>` | — | `{ ok, removed: "<id>" }` |
| `POST /moodboard/api/images/reorder` | `{ ids: [<id>…] }` complete permutation | `{ ok: true }` |
| `POST /moodboard/api/images/bulk` | `{ ids, pinned?, addTags?, removeTags?, delete? }` | `{ ok, updated, removed }` |
| `POST /moodboard/api/tags/merge` | `{ from, to }` | `{ ok, updated }` |
| `GET /moodboard/api/active` | — | `{ ok, guide: { images, allTags, tagCounts, fallback }, brief }` |
| `GET /moodboard/api/query` | `?tag=a&tag=b&match=any\|all&limit=50` | `{ ok, images, brief, total }` |
| `GET /moodboard/api/health` | — | `{ ok, version: 1, images: <n> }` |
| `GET /moodboard/api/revision` | — | `{ ok, revision, updatedAt, images }` |
| `GET /moodboard/image/<id>` | — | raw normalized image bytes, `content-type: <mediaType>`, `cache-control: private, max-age=31536000, immutable`; 404 JSON on miss |

- `data` is standard base64 (no data-URL prefix). Decode with
  `Buffer.from(data, 'base64')`. Reject base64 whose decoded length is 0 or
  whose encoded string exceeds **32 MB** (`image-too-large`).
- `revision` is a process-local monotonic integer: the Host bumps it after the
  activation load and after every committed write, and never on reads. Clients
  compare it (`/api/revision`) to detect writes made by another caller — for
  example the agent uploading references — and re-read `/api/state` only when it
  changed. It resets when the plugin Host reloads, so clients pair it with the
  board `updatedAt`: a reload that reads a newer board still refreshes once
  through the changed timestamp.
- `mediaType` must be one of the four image media types.
- Image URLs include the URL-encoded attachment id as `v`. Versioned requests
  must match the current attachment or return 404; only matching versioned
  responses are immutable. Unversioned requests return current bytes with
  `cache-control: no-store`.
- `GET /api/active`: pinned images if any, otherwise **all** images with
  `fallback: true`.
- `brief`: short plain-text style brief, e.g.
  `Active moodboard style guide (2 pinned references):\n1. name — tags: a, b; notes: …; source: …`
  Keep overview lines ≤ 400 chars, including reference IDs, names, tags, notes
  and sources. `get` returns full metadata. No HTML.
- `POST /api/images/reorder` requires every board image id exactly once; it
  rewrites `order` to the array position and returns `{ ok: true }`.
- `POST /api/images/bulk` requires at least one operation; unknown ids return
  `not-found`; `delete` wins over tag/pin updates and returns
  `{ ok, updated: 0, removed: n }`.
- `POST /api/tags/merge` replaces every case-insensitive occurrence of `from`
  with `to`, de-duplicates each image's tags and returns the number of changed
  images as `{ ok, updated }`; equal names are a no-op.
- `BoardView`: `{ version, updatedAt, images: ImageView[], allTags, tagCounts,
  pinned: [<id>…] }`.
- `ImageView`: `{ id, name, tags, notes, sourceUrl, pinned, order, createdAt,
  updatedAt, mediaType, bytes, width, height, imageUrl: "/moodboard/image/<id>?v=<attachmentId>" }`.

## Agent tool (Host)

Tool name `moodboard`, single action parameter:

```
action: 'active' | 'list' | 'query' | 'get' | 'brief'   (default 'active')
tags?: string[]        // action=query
match?: 'any' | 'all'  // action=query, default 'any'
id?: string            // action=get
includeImages?: boolean // default true for active/query/get, false otherwise
```

Behaviour:

- `active` → same selection as `GET /api/active`; includes image content blocks.
- `query` → tag filter (`any` = at least one tag, `all` = every tag); case
  insensitive; unknown tag → empty list (not an error).
- `list` → every image metadata, text only (no image blocks).
- `brief` → text brief only.
- `get` → one image by id with complete notes, tags and source URL (404-like miss returns `{ ok: false, error }` as a
  tool value with `isError`-free content text "not found").
- `includeImages` false suppresses image blocks.
- Cap image content blocks to **6** per call (`active`/`query`): the
  pinned/all selection order decides which 6; mention the omitted count in the
  text block.
- Empty board: text block `The moodboard is empty…` with instructions, no error.
- Output schema must describe `{ ok, action, brief, images, total, fallback,
  error? }`; `images` entries carry `{ id, name, tags, notes, sourceUrl,
  pinned, mediaType, bytes, width, height, attachment }` where `attachment`
  is the full normalized ref so `render` can emit image blocks.

`render(args, value)` returns a text block containing `brief` (or the error /
empty message) followed by one `{type:'image', attachment}` block per returned
image. Text is what the model reads; keep it compact.

## System prompt section

Name `moodboard:style-guide`, order `2450`. Text provider (string function):

- No images → `''`.
- Otherwise a short Markdown block that says a design moodboard exists, lists
  the pinned reference names + tags (≤ 5, one line each), and instructs:
  "Before generating or changing app UI, call the `moodboard` tool with
  `action: "active"` to load the reference images, then match their
  typography, color palette, spacing, radius, iconography and component
  styling exactly." Include `action: "query"` hint for tag lookups. Keep it
  under ~700 chars.

## Client UI spec

Panel `main` key `moodboard`, sidebar icon id `moodboard` order 20.

Layout (single React component tree, resizes from narrow to wide):

1. **Header**: title "Moodboard", image count, primary "Add images" button
   (`input[type=file] multiple accept="image/*"`), a "Copy agent brief"
   action, and the active-guide summary (pinned count).
2. **Drop zone**: the whole page body accepts drag-and-drop of image files;
   show a visible overlay/hint while a file drag is over it. Multiple files
   upload sequentially; per-file status text; failures surfaced with the
   server's error message. Also support paste-free simple file picking.
3. **Active style guide strip**: pinned thumbnails with name + tags; each can
   be unpinned; explains "the agent reads these images before designing UI".
4. **Gallery**: responsive CSS grid of thumbnails (each card: image, name,
   pinned badge, up to 3 tag chips + overflow count, hover/focus actions
   "Pin/Unpin", "Replace", "Remove"). Click selects the image. Tag filter row
   above the grid (chips with counts, plus "All"). Remove uses a two-step
   inline confirm (click Remove → "Confirm" / "Cancel"), never a blocking
   `window.confirm`.
5. **Metadata panel** for the selected image: larger preview, editable name,
   tags (chips with add-on-Enter and remove), notes textarea, source URL
   input, Pin switch (`role="switch"` + `aria-checked`), Save + Cancel,
   Replace and Remove. Save sends `PATCH` and shows "Saved"; dirty state
   guarded. Source URL renders as a clickable external link in the read view.
6. **Empty state**: explanation + drop hint + Add images button.

Behaviour:

- All state lives in one module-level store shared by every mount
  (`useSyncExternalStore`). Fetch `GET /moodboard/api/state` on plugin
  activation and after every mutation; optimistic updates are optional but the
  store must reconcile with server responses.
- **External-write refresh:** keep the board in sync with writes made outside
  this client session (the agent uploading references over HTTP, another window,
  a reconnect). Poll `GET /moodboard/api/revision` about every 3 s while the
  document is visible, and check immediately on window `focus`, `online` and
  visibility return. When the revision (or the board `updatedAt`, so a Host
  reload is noticed) differs from the last applied state, re-read `/api/state`
  **silently**: keep the loaded gallery, do not show the loading skeleton, and
  do not surface transient poll failures as an error banner while a board is
  loaded. Abort a revision read that hangs (5 s) so the poll cannot stall, and
  let a full refresh that is already running win instead of superseding it (it
  owns the loading flag). Skip checks while a refresh, upload or mutation is in
  flight. The poll and its listeners must be removed on disposal (and
  reinstalled on a later mount). Opening the panel also checks once.
- Images: fetch `imageUrl` as a blob (`fetch(url, { credentials: 'same-origin' })`),
  cache the object URL per `id + imageUrl` in a module Map. Revoke obsolete
  revisions on board refresh and all remaining URLs on plugin disposal; discard
  in-flight results for images no longer on the board. Render `<img alt={name}>`. Thumbnails can be CSS-sized (no
  server-side thumbnail route).
- Client-side downscale before upload: draw the file onto a canvas with max
  edge 1600 px, export as `image/webp` quality 0.85 (fallback `image/jpeg`
  0.85 when WebP encoding is unsupported/throws), upload the resulting base64.
  Keep GIF as-is only if no canvas decode works; otherwise the canvas path is
  mandatory. Skip files > 25 MB with a readable error.
- Errors: banner with the server `error.message`; never throw out of a
  handler; every async action catches.
- Accessibility: real `<button>`s, `aria-label` on icon buttons, `aria-live`
  status for upload/save, keyboard focus rings using theme tokens, drop zone
  labelled, `alt` text, no color-only state.
- Visible strings via locale `t()` (en + zh dictionaries registered by the
  client). Add keys used by the UI.
- Composer control (`conversation.input.right`, id `moodboard`): a compact
  button labelled "Moodboard" that inserts a directive into the draft:
  `"Use my Moodboard style guide (N pinned references). Call the moodboard
  tool with action=\"active\" before designing UI, and match the pinned
  references' typography, color palette, spacing, radius, iconography and
  component styling exactly."` Insert via
  `inputActions.insertText(text, inputActions.captureInsertion())`; if that
  returns false/unavailable use `setDraft(existing + separator + text)`.
  Disable when there is no image on the board (title explains why). Never
  submit the draft.
- The page must not assume a Session exists (it is a global panel).
- 0.2 additions: clipboard paste of image files, drag-to-reorder while no tag
  filter is active (POST reorder), multi-select (Shift/Cmd/Ctrl-click) with a
  bulk toolbar (POST bulk). The gallery renders in `order` sequence; pinned
  references keep their badge and the active strip.
- 0.3 additions: gallery search over name/tags/notes/source; reference
  lightbox; lazy thumbnail loading with a paginated gallery; `⌘A`/invert
  selection; keyboard reorder (`Alt+←/→`), `/` search focus and a `?`
  shortcuts dialog; drag-to-end zone plus details-panel Move left/right
  fallback.

## Error and edge rules

- Every handler validates JSON shape itself; no `JSON.parse` crash may escape.
- PATCH with an empty/unknown body → `invalid-body`.
- Unknown image id → `not-found` and the client removes the row after refresh.
- Do not log image bytes, base64 or notes.

## Definition of done

- `node --check index.js` and `node --check client.js` pass.
- Host: auth, state, upload, patch, replace, delete, query, active, image
  bytes, tool registration, prompt section and persistence all implemented
  without third-party imports.
- Client: all UI in the spec, no console errors expected during normal use,
  theme tokens only for chrome colors.
- Report back: what you implemented, any deviation from this contract, and
  the exact commands you ran to check syntax.

---

# 0.3.0 — Inspiration intake (added 2026-10-29)

Owner map addition: `sources.js` (source adapters) belongs to **source-dev**;
`index.js` stays **host-dev**; `client.js` stays **client-dev**; this contract,
`package.json`, `README*.md`, `CHANGELOG.md`, `docs/*.md` stay **Lead**.
`test/plugin.test.mjs` belongs to **host-dev**; `test/sources.test.mjs` to
**source-dev**; `test/client-import.test.mjs` to **client-dev**.

The goal: turn the moodboard from a passive gallery into an intake + translation
workflow — pull references from links and inspiration sources, keep provenance,
then translate them into the project's own components rather than copying.

## New file: `sources.js`

Plain ESM, `node:` builtins only, no third-party imports, no plugin context.
It performs network reads and returns **normalized drafts**; it never touches
`ctx.attachments`, the board store, or HTTP.

```js
export const SOURCE_IDS = ['web', 'mobbin', 'arena']
export const MAX_IMPORT_URLS = 20
export const MAX_IMPORT_PATHS = 20
export const MAX_DISCOVER_LIMIT = 12
export const MAX_PAGE_BYTES = 4 * 1024 * 1024
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024

export class SourceError extends Error { code } // code is a string
export function readSourceConfig(dataDir)       // never throws
export function sourceCatalog(config)          // array of catalog rows
export function detectImageMediaType(bytes)    // media type or ''
export function extractPageMetadata(html, baseUrl) // pure
export async function captureReferences(urls, options)   // -> { drafts, failures }
export async function discoverReferences(input, options) // -> { drafts, failures }
export async function readReferenceFiles(paths, options) // -> { drafts, failures }
```

**Draft** (one candidate reference):

```js
{ name, notes, tags: string[], sourceUrl, bytes: Uint8Array, mediaType, origin }
```

`origin` is `'web' | 'mobbin' | 'arena' | 'file'`. `mediaType` is one of the
four accepted image media types. `sourceUrl` is an http(s) URL when known,
otherwise `''`. `name` ≤ 200 chars; `notes` ≤ 4000; `tags` are raw provider tags
(host normalizes and caps).

**Failure** (one skipped input): `{ input, code, message }` where `input` is
the URL/path/candidate label and `message` is short and safe. Codes:
`invalid-url`, `invalid-path`, `file-not-found`, `unsupported-url`,
`unsupported-media-type`, `blocked-source`, `no-preview-image`,
`source-unauthorized`, `source-plan-required`, `rate-limited`,
`image-too-large`, `invalid-image`, `upstream-error`.

### Config

`readSourceConfig(dataDir)` reads `<dataDir>/sources.json` (bounded 64 KiB,
JSON object) and returns `{ mobbinApiKey, mobbinKeySource }` where
`mobbinKeySource` is `'env' | 'file' | null`. `MOBBIN_API_KEY` in the process
environment wins over the file. A missing, malformed, or oversized file means
no key; never throw and never log the key. The file is optional; only Mobbin
needs it.

`sourceCatalog(config)` returns:

```js
[
  { id: 'web',     kind: 'capture', label: 'Any link', available: true,
    detail: 'Capture a public page preview or an image URL.' },
  { id: 'mobbin',  kind: 'search',  label: 'Mobbin', available: Boolean(key),
    detail: key ? 'Mobbin REST API connected.' : 'Set MOBBIN_API_KEY (Team/Enterprise) to search Mobbin screens.',
    platforms: ['ios', 'web'] },
  { id: 'arena',   kind: 'search',  label: 'Are.na', available: true,
    detail: 'Public Are.na search, no key needed.' },
  { id: 'dribbble', kind: 'browser', label: 'Dribbble', available: false,
    detail: 'Dribbble blocks server-side capture; use the browser MCP workflow or upload a screenshot.' }
]
```

### URL safety (mandatory)

- Only `http:` / `https:`; max 2000 chars; no embedded username/password.
- Reject `localhost`, `*.localhost`, `*.local`, `*.internal`, and IP literals in
  private/reserved ranges (IPv4 RFC1918, loopback, link-local, CGNAT; IPv6
  loopback, ULA, link-local, IPv4-mapped private).
- Resolve other hostnames with `node:dns/promises` `lookup(host, { all: true })`
  and reject if **any** address is private; DNS failures are `upstream-error`.
- Follow at most 3 redirects manually, re-validating every hop.
- Timeout every request (default 15 s page, 25 s API); cap page bodies at
  `MAX_PAGE_BYTES` and images at `MAX_IMAGE_BYTES` while reading.
- Page/image capture sends a normal browser `user-agent` plus
  `dsh-moodboard/0.3`. Discovery API requests instead send the honest
  `dsh-moodboard/0.3 (+https://github.com/Stijnus/dsh-moodboard)` user-agent:
  Are.na rejects a browser UA as unidentified automation. Never forward cookies
  or auth headers to arbitrary hosts.

### Capture (`captureReferences`)

- Accepts 1..20 URLs. Dedupe within the batch by exact URL.
- If a URL serves an image content type (or bytes with an image signature),
  capture it directly: name from the URL path, notes `Image from <host>.`,
  tags `['web', <host>]`, sourceUrl = final URL.
- Otherwise require an HTML page. Extract in this priority order:
  `og:image`, `og:image:url`, `twitter:image`, `twitter:image:src`,
  `link[rel=image_src]`, `meta[itemprop=image]`, then the first absolute
  `<img src>`. Resolve relative URLs against the final page URL.
- Title: `og:title`, `twitter:title`, `<title>`, `og:site_name`, hostname.
- Description: `og:description`, `meta[name=description]`,
  `twitter:description`. Author: `meta[name=author]`, `article:author`,
  `twitter:creator`. Site: `og:site_name` or hostname.
- Name: title or site name, collapsed and clipped; fall back to hostname.
- Notes: `Captured from <site> (<host>) — <title> by <author>. <description>`
  with empty parts omitted, clipped to 4000. Tags: `['web', <host>]`.
- SourceUrl: the canonical URL when present, else the final URL.
- A Dribbble host that returns a bot-challenge/empty body is
  `blocked-source` with the browser-MCP guidance; do not retry aggressively.
- No preview image → `no-preview-image` (suggest uploading a screenshot).
- Options: `{ fetchImpl, lookupImpl, timeoutMs }` for tests; defaults use
  global `fetch` and `dns.lookup`. User `tags`/`notes` are merged by the host,
  not by this adapter.

### Discover (`discoverReferences`)

Input `{ source: 'mobbin' | 'arena', query, platform, limit }`. Query 1..500,
platform `ios|web` (Mobbin only, default `ios`), limit 1..12 (default 6).
Returns drafts and per-candidate failures; one bad image never aborts the batch.

**Mobbin** — `POST https://api.mobbin.com/v1/screens/search`, header
`authorization: Bearer <key>`, body
`{ query, platform, mode: 'standard', limit }`. Map 401 → `source-unauthorized`,
403 → `source-plan-required`, 429 → `rate-limited` (respect `Retry-After` when
present), other non-2xx → `upstream-error`. For each screen download
`screen.image.url` (or deprecated `screen.image_url`) **immediately** because
those URLs expire. Draft: sourceUrl `mobbin_url`, name
`<app_name> — <query>`, notes mention Mobbin, app name, platform, query and the
source URL, tags `['mobbin', platform, app_name]`.

**Are.na** — `GET https://api.are.na/v2/search?q=<query>&per=<wider page>`. Its
`per` is a shared result budget across channels and blocks, so a small value can
return zero blocks; request `min(100, max(20, limit * 4))` and take the first
`limit` image blocks. Use `blocks[].image.large.url || display.url ||
original.url`. sourceUrl is `block.source.url` when http(s), else
`https://www.are.na/block/<id>`; name is `block.title` / source title /
`Are.na reference`; notes mention Are.na and the block id; tags `['arena']`.

Options include `{ config, fetchImpl, lookupImpl, endpoints, timeoutMs }`;
`endpoints` defaults to the production URLs and exists only for deterministic
tests.

### Local files (`readReferenceFiles`)

Agent-facing bridge for screenshots captured by browser MCP or the user. Accept
1..20 **absolute** regular-file paths, each ≤ 12 MiB, detect the media type from
`node:fs` bytes (PNG/JPEG/WebP/GIF), name from the basename, sourceUrl `''`,
tags `['file']`, origin `file`. Reject directories, missing files, non-images.

## Host: new HTTP routes

Add to the existing `/moodboard` prefix router:

| Method + path | Body | Success |
|---|---|---|
| `GET /moodboard/api/sources` | — | `{ ok, sources, workflow, configPath }` |
| `POST /moodboard/api/import` | see below | `{ ok, imported, duplicates, failures }` |

`GET /api/sources` uses `readSourceConfig(dataDir)` on every call (so editing
the config needs no restart), `sourceCatalog`, the workflow text, and the
absolute config path.

`POST /api/import` body (balanced 128 KiB):

```json
{ "urls": ["https://…"], "tags": ["dashboard"], "notes": "", "pinned": false }
{ "source": "mobbin", "query": "checkout paywall", "platform": "ios", "limit": 6, "tags": [], "pinned": false }
{ "paths": ["/tmp/mobbin-shot.png"], "tags": [], "notes": "" }
```

Exactly one intake mode (`urls` | `paths` | `source`+`query`); otherwise
`invalid-body`. `urls`/`paths` are arrays of 1..20 strings; `source` is
`mobbin|arena`; `query` 1..500 chars; `platform` `ios|web`; `limit` 1..12.
`tags`, `notes`, `pinned` are the existing validated fields.

Import flow is shared by the HTTP route and the agent tool:

1. Call the adapter; keep `drafts` and `failures`.
2. For each draft: dedupe by non-empty `sourceUrl` already on the board →
   append the existing `ImageView` to `duplicates` and skip the save.
3. Board capacity: stop importing and append a `board-full` failure for each
   remaining draft.
4. Merge notes: user notes first, blank line, provider notes (clip 4000).
5. Merge tags: provider tags first, then user tags; `normalizeTagList`.
6. Save through `saveImageBytes`, create the entry, apply `pinned`.
7. Return `{ ok: true, imported: [ImageView], duplicates: [ImageView],
   failures: [{ input, code, message }] }` with HTTP 200 even when some or all
   items failed. Only malformed requests / auth fail with the normal envelope.
8. Never log fetched bytes, notes, URLs' query strings, or API keys.

New error codes for route-level failures: `source-unavailable` (503),
`upstream-error` (502), `rate-limited` (429). Item failures use the same codes
inside `failures` and never change the batch status.

## Host: agent tool additions

`TOOL_ACTIONS` becomes:
`active | list | query | get | brief | import | sources | workflow`.

New parameters:

```
urls?: string[]        // import: capture public links
paths?: string[]       // import: local screenshots (browser MCP bridge)
source?: 'mobbin'|'arena' // import: discover and add
query?: string         // import: search query for the source
platform?: 'ios'|'web' // import: Mobbin platform
limit?: number         // import: 1..12 results
tags?: string[]        // import: extra tags (also query, existing)
notes?: string         // import: user note
pinned?: boolean       // import: pin imported references
```

- `import` requires exactly one mode; it runs the shared import flow and returns
  the imported images (image blocks capped at 6) plus a compact summary and the
  failure list.
- `sources` returns the catalog as text (available/needs key), the config path,
  and the browser-MCP bridge hint.
- `workflow` returns the workflow text plus the active brief; no image blocks.
- `import` output uses `images` for imported references, `total` = imported
  count, `fallback: false`, plus optional `failures`, `duplicates`, `sources`,
  `workflow` fields. Existing actions keep their shape.
- Tool description must name the new abilities: capturing link previews,
  Mobbin/Are.na discovery, importing local screenshots, listing sources, and the
  reference-to-component workflow.

## Host: workflow text + prompt section

Add a constant `INSPIRATION_WORKFLOW` (plain Markdown, ≤ 2200 chars) used by
`GET /api/sources`, `action: "workflow"`, and the panel copy action. Required
content:

1. Collect 5–10 references for the same job; keep source links.
2. Curate with role tags (layout, type, palette, component, motion); pin the
   2–4 that define the direction.
3. Extract what to borrow and what not to copy (structure, spacing rhythm, type
   scale, color roles, radius/elevation, icon style, motion); exclude branding,
   copy, logos, and assets.
4. Translate into the project's own tokens and content for the page archetype.
5. Build one representative component per role with states, dark mode,
   keyboard/focus, responsive behavior and reduced motion.
6. Verify at the same viewport: structure/rhythm, then type/color, then
   interaction; check contrast, hit targets, overflow and motion fallbacks.
7. Record the component and reuse the pinned references as the style guide;
   delete references that no longer define the direction.

Add a second system-prompt section `moodboard:inspiration-workflow`
(order `2455`, ≤ 700 chars). Text is `''` when the board has no images;
otherwise it says pinned references are the direction, to compare several,
reuse structure/spacing/type/color roles without copying branding/copy/assets,
to annotate borrow vs avoid, and points at `moodboard` actions `import` and
`workflow`. Do not repeat the whole workflow in the prompt.

## Client additions

- Header action **"Add from link"** (`ImportDialog`) next to Paste/Add images;
  empty state also offers it.
- Dialog has two modes:
  - **Link**: textarea for 1..20 URLs (newline or whitespace separated), tags
    input, pin toggle, submit "Add references".
  - **Discover**: source select for available search sources (Mobbin/Are.na),
    query input, platform select for Mobbin, limit 1..12, tags, pin toggle,
    submit "Search & add". If Mobbin is unavailable, show the config hint
    (`MOBBIN_API_KEY` or `<configPath>`), not a disabled dead end.
- Loads `GET /api/sources` when opened (cache per mount); result panel shows
  added / already-on-board / failed counts, first few failure messages, and a
  **Copy workflow** action using the returned workflow text.
- Calls `POST /api/import`; on success refreshes the board (silent refresh, no
  skeleton), closes on "Done" only; errors use the existing error banner.
- Accessible dialog: `role="dialog"`, `aria-modal="true"`, labelled, focus
  trapped, Esc closes, restore focus to the opener; theme tokens only; en+zh
  strings through the locale dictionaries. No `window.confirm`.
- Client must not fetch third-party URLs directly; all fetching is host-side.

## Docs (Lead)

`docs/INSPIRATION-WORKFLOW.md` documents the workflow, the source matrix
(any link, Mobbin REST/MCP, Are.na, Dribbble browser capture), MCP setup in
`~/.dsh/cordis.patch.yml` (`chrome-devtools-mcp` / `@playwright/mcp`), the
import tool bridge, licensing/respect-for-designers rules, and current
limitations (Mobbin MCP OAuth is not supported by `dsh-mcp-client`; use the
REST API or browser capture). README gets a short version and links it.
CHANGELOG gets a 0.3.0 entry. `package.json` bumps to `0.3.0` and ships
`sources.js`.

## Definition of done (0.3.0)

- `npm test` passes (existing tests updated where the contract intentionally
  changed; new unit/integration coverage for sources, imports, tool actions).
- `node --check index.js client.js sources.js` passes; no third-party imports.
- `npm pack --dry-run` includes `sources.js`.
- No secrets logged; no network call happens during plugin activation; all
  intake is lazy per request.
- The panel still loads and works with no `sources.json` (only Mobbin disabled).
