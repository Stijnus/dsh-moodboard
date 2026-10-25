> **Packaging note.** This bundle is published as `@stijnus/dsh-moodboard`.
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
| `GET /moodboard/api/state` | — | `{ ok, board: BoardView }` |
| `POST /moodboard/api/images` | `{ data, mediaType, name?, tags?, notes?, sourceUrl? }` | `{ ok, image: ImageView }` |
| `PATCH /moodboard/api/images/<id>` | any of `{ name, tags, notes, sourceUrl, pinned, order }` | `{ ok, image }` |
| `POST /moodboard/api/images/<id>/replace` | `{ data, mediaType, name? }` | `{ ok, image }` |
| `DELETE /moodboard/api/images/<id>` | — | `{ ok, removed: "<id>" }` |
| `GET /moodboard/api/active` | — | `{ ok, guide: { images, allTags, tagCounts, fallback }, brief }` |
| `GET /moodboard/api/query` | `?tag=a&tag=b&match=any\|all&limit=50` | `{ ok, images, brief, total }` |
| `GET /moodboard/api/health` | — | `{ ok, version: 1, images: <n> }` |
| `GET /moodboard/image/<id>` | — | raw normalized image bytes, `content-type: <mediaType>`, `cache-control: private, max-age=31536000, immutable`; 404 JSON on miss |

- `data` is standard base64 (no data-URL prefix). Decode with
  `Buffer.from(data, 'base64')`. Reject base64 whose decoded length is 0 or
  whose encoded string exceeds **32 MB** (`image-too-large`).
- `mediaType` must be one of the four image media types.
- `GET /api/active`: pinned images if any, otherwise **all** images with
  `fallback: true`.
- `brief`: short plain-text style brief, e.g.
  `Active moodboard style guide (2 pinned references):\n1. name — tags: a, b; notes: …; source: …`
  Keep each line ≤ 400 chars; include only pinned/all names, tags, notes and
  sources. No HTML.
- `BoardView`: `{ version, updatedAt, images: ImageView[], allTags, tagCounts,
  pinned: [<id>…] }`.
- `ImageView`: `{ id, name, tags, notes, sourceUrl, pinned, order, createdAt,
  updatedAt, mediaType, bytes, width, height, imageUrl: "/moodboard/image/<id>" }`.

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
- `get` → one image by id (404-like miss returns `{ ok: false, error }` as a
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
- Images: fetch `imageUrl` as a blob (`fetch(url, { credentials: 'same-origin' })`),
  cache the object URL per `id + updatedAt` in a module Map, revoke on plugin
  disposal. Render `<img alt={name}>`. Thumbnails can be CSS-sized (no
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
