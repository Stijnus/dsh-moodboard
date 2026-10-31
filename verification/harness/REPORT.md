# dsh-moodboard real-render harness

Last verified: 2026-10-31 (Chrome stable, macOS, harness run `node verification/harness/capture.mjs`)

## What this is

A browser harness that executes the **real `client.js`** (the actual plugin
factory, `apply(ctx)`, `MoodboardPage` and every dialog component) under a
stubbed DSH host, so the plugin UI can be screenshotted without launching the
Harness shell. It is not a mock of the page: the only stubbed layers are the
host (module loader, locale service, slots registry, HTTP API, image bytes) and
a small React-compatible renderer.

The current screenshots show the **already redesigned Warm Sand Studio UI** in
the working tree. (`capture.mjs` loads `/client.js`, i.e. the live file.)

## Run it

```bash
cd "/Users/stijnus/Developer/GitHub/Deepseek Plugins/dsh-moodboard"
node verification/harness/capture.mjs
```

The PNG screenshots and `snapshots/` are generated local artifacts and are
not committed (see `verification/harness/.gitignore`); `shots/console.json` is
committed as the machine-readable evidence for the last run. Run the command
above to regenerate every screenshot.

This starts a verified static server, launches headless Chrome, drives the
captured `main` slot, writes the PNGs below plus `shots/console.json`, and
exits 0 only when every render check passed with no page/console errors.

Why not `playwright-cli`: its default session cache (`~/Library/Caches/ms-playwright`)
is not writable in this sandbox. `capture.mjs` therefore drives the **bundled
`playwright-core`** directly with `HOME` relocated to `/tmp/pwhome` and the
**system Google Chrome** channel (`channel: "chrome"`), which needs no browser
download. Overrides:

| Variable | Default | Purpose |
|---|---|---|
| `HARNESS_HOME` | `/tmp/pwhome` | relocated HOME for Chrome/Playwright |
| `HARNESS_CHANNEL` | `chrome` | Playwright browser channel |
| `HARNESS_PORT` | `4173` | static-server port (falls back to an ephemeral port when busy) |
| `HARNESS_PLAYWRIGHT_CORE` | bundled `@playwright/cli/.../playwright-core/index.mjs` | custom playwright-core entry |

Manual inspection:

```bash
node verification/harness/serve.mjs 4173
# open http://127.0.0.1:4173/verification/harness/index.html
```

Query parameters on `index.html`:

| Param | Values | Meaning |
|---|---|---|
| `theme` | `light`, `dark` | sets `[data-theme]` and the harness token block |
| `board` | `default`, `empty` | empty-board fixture |
| `client` | URL | alternative client build to execute |

`window.HARNESS.snapshot()` returns a machine-readable render summary
(card/chip/pin counts, hero, inspector title, open dialogs, bulk/lightbox
presence, captured errors). `window.HARNESS.settle(ms)` waits for the page,
fonts and object-URL thumbnails to finish painting.

## Screenshots (`verification/harness/shots/`, all 1280×900 @ 1× DPR)

| File | What it shows |
|---|---|
| `01-page-light.png` | Moodboard page, light tokens: coral mark header, warm hero strip with 3 pinned references, gallery of 6 cards, tag filters, header actions |
| `02-empty-light.png` | Empty board state (warm dashed card, primary Add images action) |
| `03-add-references.png` | “Add references” dialog, From links tab |
| `04-add-references-discover.png` | Same dialog, Discover tab (Are.na source, platform, results, Mobbin key hint) |
| `05-inspector.png` | Reference inspector open on the pinned primary reference (preview, name, tags, notes, source, sticky footer) |
| `06-shortcuts.png` | Keyboard shortcuts dialog |
| `07-tag-merge.png` | Merge tags dialog with every board tag as a chip |
| `08-page-dark.png` | Moodboard page, dark token variant |
| `09-inspector-dark.png` | Inspector dark variant |
| `10-add-references-dark.png` | Add references dialog dark variant |
| `11-lightbox.png` | Image lightbox (double-click a card): preview, tags, notes, source |
| `12-bulk-selection.png` | Multi-select bulk bar (⌘/Ctrl-click two cards) |

`shots/console.json` records URL, client URL, checks, page errors and every
console message for the run.

## Components the harness actually executes

The plugin's own module is loaded through a stubbed `window.__ModuleLoader__`,
its `factory(require('react'))` runs against `mini-react.js`, and `apply(ctx)`
is called with a real `ctx` surface:

- `ctx.effect(fn)` — runs refresh, board-sync polling, disposal effects.
- `ctx.locale.register(NS, DICTIONARIES)` + `ctx.locale.bind(NS)` — the module's
  real `en` dictionary, interpolation included.
- `ctx.slots.inject(...)` / `ctx.slots.register(...)` — captures
  `sidebar.panellist`, `main`, `conversation.input.right`. The harness mounts the
  captured `main` component (`MoodboardPage`); the other two are captured but
  not mounted.
- `fetch` → `/moodboard/api/state`, `/revision`, `/sources`, `/active`,
  `/query`, `/health`, image mutations, `/moodboard/image/<id>`.
  The API stub follows `docs/CONTRACT.md` envelopes and mutations; image paths
  go through the real `fetch → Blob → URL.createObjectURL → <img>` pipeline, so
  `useImageUrl` + `IntersectionObserver` lazy rendering is exercised.
- The real `PAGE_CSS` and `REFERENCE_CSS` template strings render through the
  component's own `<style>` elements; real DOM event handlers drive clicks,
  double-click, ⌘-click, Escape and focus traps.
- Rendered components include `MoodboardPage`, `Thumb`, `MetadataPanel`,
  `ImportDialog`, `TagMergeDialog`, `ShortcutsDialog`, the lightbox, bulk
  toolbar, all inline SVG icons, and the `useSyncExternalStore` shared store.

## Console status

Clean: the last capture reports **0 page errors, 0 console error messages**,
9 render assertions passed (gallery + pinned badges, empty state, import
dialog, inspector, shortcuts, tag merge, dark page, lightbox, bulk bar).
`console.json` is the evidence.

## Fidelity versus the real DSH host

Faithful for layout, component structure, CSS, tokens, dialogs and interactive
states. Differences are deliberately bounded to the host surface:

- **Tokens are the assignment's real DSH alias names/values**, not a live read
  of the running Harness theme. Light/dark values were taken from the task
  brief; if the DSH theme changes its palette, update `style.css`.
- **No DSH shell chrome**: sidebar, conversation composer, window frames and
  `--dsh-frame-top-clearance` are absent (`0px` here). The page is mounted in a
  1280×900 main region exactly as captured.
- **Fonts** fall back to the system stack. The redesign asks for
  “SF Pro Rounded → ui-rounded → Avenir Next → Nunito”; Chrome resolves
  whatever the OS exposes, which may differ from the packaged Electron app.
- **Animations are paused for screenshots** (`animations: 'disabled'`), and
  hover states are not forced; both can differ from a live app.
- Chromium (system Chrome stable) is the render engine; the Harness Web GUI may
  embed a different Chromium version.

## What the harness cannot exercise

- **Real host persistence and revision semantics**: `/state`, `/revision`,
  board writes and image bytes are deterministic stubs; nothing is written to
  `~/.dsh/moodboard/board.json`.
- **File upload / replace pipeline**: drag-and-drop, the file picker, canvas
  encode (`MAX_EDGE`/`ENCODE_QUALITY`) and base64 `POST /images` are not
  captured; the POST/import stubs return synthetic images only.
- **Clipboard**: copy agent brief and paste-image depend on browser clipboard
  permissions and are not in the screenshot set.
- **Live sync with another writer/agent**: the page's real 3 s `/revision`
  polling runs against the stub. Stub writes mutate state and are picked up, but
  multi-window reconnect/visibility semantics are untested.
- **The other two slots**: the sidebar panel button and the composer reference
  control are registered but not mounted (they need host layout/`useInput`).
- **Full keyboard/AT audit**: focus traps, Esc and ⌘A are implemented by the
  real code and basic interactions work, but this is a screenshot harness, not
  an accessibility test runner.
- **Responsive layouts below 1280** and native browser UI (select popups,
  tooltips) are out of scope.

## mini-react limits

`mini-react.js` is a purpose-built shim, not React:

- Supported: `createElement` (className, style objects, event props, keys,
  object + function refs), `Fragment`, `useState`, `useReducer`, `useEffect`,
  `useLayoutEffect`, `useRef`, `useMemo`, `useCallback`, `useId`,
  `useSyncExternalStore`, controlled `value`/`checked` inputs, autoFocus.
- Keyed DOM reconciliation reuses nodes, so focus/caret and object URLs survive
  state updates; state updates batch into a microtask.
- Unsupported/absent (and unused by the plugin): context, portals, class
  components, Suspense, error boundaries, hydration, concurrent features.
- A component returning multiple root nodes is wrapped in a `display:contents`
  span; every component currently rendered returns a single root.

## Fixtures and provenance

`fixtures/` holds six neutral reference screenshots derived from repo assets —
`test/fixtures/harness-light-reference.png`, `test/fixtures/harness-dark-replacement.png`,
`docs/panel.jpg` and `docs/import-dialog.jpg` — resized/cropped to 900×675 JPEG.
They are fixtures only, never user data. `fixture-board.js` describes the board
(6 images, 3 pinned, 15 tags) plus the source catalog used by the Discover tab.
Fixture image bytes are served from `fixtures/` through the stub, not embedded.

`fixtures/README.md` documents the mapping.

## Optional: pre-redesign comparison build

`snapshots/client-before-redesign.js` is `git show HEAD:client.js` (commit in
`snapshots/HEAD.sha`), kept for an A/B comparison of the old UI. It is **not**
used by `capture.mjs` (which loads the live working-tree `client.js`). To look
at the old build:

```
http://127.0.0.1:4173/verification/harness/index.html?client=/verification/harness/snapshots/client-before-redesign.js
```

## Files

```
verification/harness/
  index.html            mount point + script order
  style.css             real DSH alias tokens (light/dark) + 1280×900 canvas
  mini-react.js         React-compatible shim (hooks + keyed reconciler)
  fixture-board.js      deterministic BoardView fixture + source catalog
  host-stub.js          __ModuleLoader__, ctx, fetch/API + image stub
  harness-boot.js       loads a client build, applies it, mounts main slot
  serve.mjs             dependency-free static server (repo-root scoped)
  capture.mjs           Playwright capture driver + assertions + console.json
  fixtures/*.jpg        fixture thumbnails
  snapshots/            optional HEAD (pre-redesign) client build
  shots/*.png           captures (1280×900)
  shots/console.json    machine-readable run report
```

## Adding a state

1. Add a route/state to `fixture-board.js` or read a new query param in
   `harness-boot.js` / `host-stub.js`.
2. In `capture.mjs`, `goto()`, drive the real component (locator clicks/keys/
   fills), `page.evaluate(() => window.HARNESS.settle(150))`, then `shot()`.
3. Add a `record(...)` assertion so a broken render fails the capture instead of
   silently writing a blank screenshot.

Only files under `verification/harness/` were created by this task; `client.js`,
`index.js`, `sources.js`, `docs/`, `test/`, `package.json` and `README.md` were
not edited.
