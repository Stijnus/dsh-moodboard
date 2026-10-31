# From inspiration to your own components

This is the workflow the Moodboard plugin is built around: collect references,
keep their provenance, extract only transferable design decisions, and rebuild
them as components in your own system. The plugin now provides the intake half
(links, Mobbin, Are.na, local screenshots) and the agent half (a `workflow`
action and prompt guidance). The build-and-verify half happens in your project.

## The seven steps

### 1. Collect — 5–10 references for the same job

Aim for coverage of one problem, not a random gallery. For a checkout screen,
collect several checkout screens: empty, filled, error, mobile, desktop.

Add references from:

- **Add from link** in the panel (or `moodboard action="import"` with `urls`):
  any public page with an Open Graph preview, or a direct image URL.
- **Discover** in the panel (or `action="import"` with `source` + `query`):
  Mobbin screens (REST API key required) and Are.na search.
- **Upload / paste / drag** a screenshot when a site blocks server-side capture.
- **Browser MCP capture** for authenticated or bot-protected sites such as
  Dribbble and Mobbin's web UI. The agent screenshots to a local file and calls
  `moodboard action="import"` with `paths`.

Every captured reference keeps its `sourceUrl`. That is not decoration: it is
how you credit the designer, re-check the source, and avoid treating a single
shot as a pattern.

### 2. Curate — tag by role, pin the direction

Tag what a reference is *for*, not what it looks like:

| Tag | Meaning |
|---|---|
| `layout` | page composition, grid, section rhythm |
| `type` | type scale, pairings, hierarchy |
| `palette` | color roles, surfaces, accent behavior |
| `component` | a specific control or row/card/table pattern |
| `motion` | transitions, feedback, choreography |
| `flow` | multi-step sequence (onboarding, checkout, paywall) |

Pin the two to four references that define the current direction. Pinned
references are the active style guide the agent loads before generating UI.
Unpinned references stay as evidence — useful for comparison, not authority.

### 3. Extract — write borrow / avoid notes

For each pinned reference, open its inspector and write notes in two buckets:

```text
Borrow: white cards on warm sand; 16–20px radius; one coral CTA per screen;
        large friendly numerals as the card hero; 8pt spacing rhythm.
Avoid: the brand's logo, mascot, product photos, exact copy, the purple
        gradient (off-brand for us), the 3-column marketing grid.
```

Also record the page archetype in the note ("consumer app home", "B2B
dashboard", "pricing page"). The same visual treatment is often wrong for a
different archetype — the page type wins over the mood.

### 4. Translate — restate in your own tokens

Turn observations into decisions that fit **your** product:

- color roles (`surface`, `surface-muted`, `accent`, `ink`, states), not copied
  hex values;
- a type scale and weights, not a font license you do not have;
- a spacing scale and radius/elevation scale;
- an icon style and stroke rule;
- a motion personality (tempo, easing, one signature motif);
- imagery strategy (photography, 3D, illustration, none).

If the reference's identity depends on protected assets, branding, copy, or a
signature illustration, leave it out. The goal is the *grammar*, not the skin.

### 5. Build — one representative component per role

Build the smallest honest slice first: a real page section or component with
its states, not a hero mock. Cover hover/focus/disabled/loading/empty/error,
dark mode, keyboard and focus order, reduced motion, and the narrow viewport.
Reuse the project's existing component primitives; do not start a parallel
system for one screen.

### 6. Verify — compare against the reference

Compare at the same viewport and in the same state:

1. structure and spacing rhythm,
2. type hierarchy and color roles,
3. interaction and motion.

Fix drift before adding polish. Then run the non-negotiable checks: contrast,
target sizes, overflow/truncation, keyboard reachability, `prefers-reduced-motion`
fallbacks, and performance.

### 7. Record — make the direction reusable

Keep the pinned references and the final component in the project's design
notes. Delete references that no longer define the direction, and merge
overlapping tags. The next agent session should be able to load the same guide
and reproduce the component without a conversation.

## Ask the agent for it

```text
Pull 6 Mobbin screens matching "checkout with promo code and Apple Pay"
(ios), tag them component + checkout, and pin the two strongest.
Then extract borrow/avoid notes and draft the checkout summary component
with our own tokens — do not copy branding or copy.
```

The agent can call:

- `moodboard { action: "import", source: "mobbin", query: "...", platform: "ios", limit: 6, tags: ["component","checkout"] }`
- `moodboard { action: "import", urls: ["https://…"] }`
- `moodboard { action: "import", paths: ["/tmp/mobbin-checkout.png"] }`
- `moodboard { action: "workflow" }` for this method plus the active brief
- `moodboard { action: "active" }` before writing UI

The panel exposes the same intake through **Add from link**, and its results
panel has a **Copy workflow** action.

## Source coverage and requirements

| Source | How it works | Requirements | Limits |
|---|---|---|---|
| Any public link | Host fetches the page and reads its Open Graph/Twitter preview image and metadata | None | No preview image → upload a screenshot. Sites behind bot protection (Dribbble, Behance, Land-book) fail with guidance. |
| Direct image URL | Host downloads and stores the image | None | PNG/JPEG/WebP/GIF, max 12 MiB; SVG is not accepted. |
| Mobbin | Official REST API: `POST https://api.mobbin.com/v1/screens/search` | `MOBBIN_API_KEY` (Team or Enterprise) in the environment or `<DSH_HOME>/moodboard/sources.json` | 60 requests/min; image URLs expire, so the plugin downloads them immediately into the attachment store. |
| Are.na | Public search API: `GET https://api.are.na/v2/search` | None | Public blocks only; the first 12 **image** blocks per import (text blocks are skipped and do not consume the quota). |
| Dribbble | No public search API; shot pages block server fetches (Cloudflare). Use a browser MCP or upload the image. | Browser MCP (optional) | Do not scrape; respect Dribbble's terms. |
| Pinterest / Behance / Land-book | Mostly OAuth-only or bot-protected | Not built in | Generic link capture when the site allows it; otherwise a screenshot. |

### Mobbin setup

1. Get a workspace API key on a Team or Enterprise plan (Mobbin docs:
   <https://docs.mobbin.com/openapi.json>).
2. Either export it before starting the Harness:

   ```sh
   export MOBBIN_API_KEY="..."
   ```

   or write it to the local config file (mode `0600` recommended):

   ```json
   { "mobbinApiKey": "..." }
   ```

   at `<DSH_HOME>/moodboard/sources.json` (`~/.dsh/moodboard/sources.json` by
   default). The environment variable wins. The config is re-read on every
   import, so no restart is needed after editing the file.
3. Check **Add from link → Discover**: Mobbin should be selectable. The key is
   never returned by the API or shown in the panel.

Mobbin's own MCP server (`https://api.mobbin.com/mcp`, Streamable HTTP, OAuth)
is a good fit for clients that implement OAuth, but the current
`@deepseek-ai/dsh-mcp-client` configuration exposes only URL + headers, not an
OAuth flow. Use the REST API above from this plugin, or use the browser-MCP
capture path. See <https://mobbin.com/mcp.md>.

### Browser MCP capture (Dribbble, Mobbin web UI, logged-in sites)

Add one browser MCP server to your DSH profile. Edit
`~/.dsh/cordis.patch.yml` and add an entry like this (keep the rest of the file):

```yaml
- insert:
    - id: mcp-chrome
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: chrome
        transport: stdio
        command: npx
        args: ['-y', 'chrome-devtools-mcp@latest', '--autoConnect', '--no-usage-statistics']
        toolCallTimeoutMs: 120000
```

`--autoConnect` connects to your running Chrome (Chrome 144+; allow the
permission dialog). Alternatively use `--browser-url http://127.0.0.1:9222`
after starting Chrome with remote debugging, or use Playwright MCP:

```yaml
    - id: mcp-playwright
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: playwright
        transport: stdio
        command: npx
        args: ['-y', '@playwright/mcp@latest', '--browser', 'chrome', '--user-data-dir', '/Users/<you>/.dsh/playwright-profile']
        toolCallTimeoutMs: 120000
```

Restart the Harness. The agent sees tools such as `mcp__chrome__take_screenshot`
or `mcp__playwright__browser_take_screenshot`, navigates to the inspiration
page, saves a screenshot to an absolute path, then imports it:

```json
moodboard { "action": "import", "paths": ["/tmp/refs/dribbble-1.png"], "tags": ["component"] }
```

Keep the browser MCP pointed at a dedicated profile if you sign in to paid
libraries. Do not commit cookies or API keys.

## Working with reference libraries responsibly

- **References are evidence, not assets.** Do not ship screenshots, logos,
  illustrations, copy, or brand elements from a reference. Rebuild structure
  and behavior with your own content and tokens.
- **Crediting matters.** Keep `sourceUrl` on every reference and the designer or
  product name in its notes. Mobbin and Are.na results include their URLs; the
  plugin preserves them.
- **Respect platform terms and rate limits.** Use official APIs where they
  exist (Mobbin REST, Are.na). Do not bulk-scrape a site that blocks automated
  access. Mobbin limits API use to 60 requests/minute; the plugin surfaces
  `rate-limited` failures instead of retrying in a loop.
- **Local-first storage.** Captured images are stored in your local attachment
  store. Mobbin image URLs expire, so the plugin copies the bytes; that copy is
  for your personal design reference, under your subscription's terms.
- **A pattern is not proof.** A recurring flow is a convention, not evidence
  that it converts better. Evaluate accessibility and fit independently.

## Current limitations

- Mobbin's MCP OAuth flow is not supported by `dsh-mcp-client` today; use the
  REST adapter or browser capture.
- Dribbble has no public search API and blocks server-side page fetches. Browser
  capture or manual upload is the only supported route.
- The generic link capture reads Open Graph/Twitter metadata only; pages without
  a preview image fail with `no-preview-image` rather than guessing.
- No automatic screenshot/thumbnail generation for arbitrary sites (no
  headless browser inside the plugin). That is intentional: the plugin stays a
  dependency-free host, and browser capture belongs to a browser MCP.
- Imported images are normalized by the attachment service (WebP/JPEG), so the
  stored file may not match the source encoding. Source URLs and notes are kept.
- Are.na search results mix text and image blocks. Only image blocks count
  toward the requested result limit; text blocks are skipped rather than
  imported as `no-preview-image` failures. A discovery `source` must be
  `mobbin` or `arena`; any other id is rejected with `invalid-argument` before
  any network request.
