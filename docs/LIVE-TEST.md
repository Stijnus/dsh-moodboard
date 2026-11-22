# Live Harness verification — 2026-11-22 (0.4.3 → 0.4.4)

Tested in a throwaway DeepSeek Harness 0.2.2-rc.5 web profile (isolated
`DSH_HOME`, `dsh --profile web --no-open`), driven in a browser.

## 0.4.3 from npm

- `dsh plugin --profile web add dsh-moodboard@0.4.3`; the bundle was listed in
  the profile automatically. Panel and composer control rendered; empty state
  correct.
- Uploads through the panel's file input: a 400×300 PNG was stored byte-for-byte
  (8,221 bytes); a 2400×1500 PNG was stored as a 1600×1000 PNG; a JPEG was sent
  unchanged (6,907 bytes) and re-encoded by the Harness attachment store
  (5,831 bytes stored). Each upload was one POST plus one image GET, with no
  `/api/state` re-read; the revision poll ran every 3 s with the panel open.
- HTTP API: `health`, `PATCH` (response revision exactly +1), `active`,
  `query?tag=brand` (case-insensitive), `sources`. Import: a `localhost` link
  was refused (`unsupported-url`), `example.com` reported `no-preview-image`, a
  GitHub page failed because GitHub's preview-image host answered HTTP 429, and
  a Wikimedia PNG imported over HTTPS through the pinned transport. Re-importing
  it (plus a `?utm_source` variant) returned two duplicates and no new image.
- API writes appeared in the open panel through the revision poll. Lightbox
  (focus on Close, 2 / 5 counter, Esc), pin, Cmd+A bulk bar ("5 selected"),
  clear, and delete with confirmation all worked; no console errors.
- Stopped the Harness completely and restarted it: all images, pins and tags
  were back and every image route answered 200. `board.json` is mode 0600.

## 0.4.4 candidate (packed checkout)

- A plain `<img src>` on `/moodboard/image/<id>?v=…` loads on the same origin
  (the session cookie is HttpOnly and is sent with image requests); the same
  URL from another origin is refused.
- With the packed checkout installed, all panel images load from their direct
  URLs (no fetch-based image requests); the lightbox loads the full image the
  same way. In the verification harness, where direct image URLs 404, every
  thumbnail fell back to a blob URL and rendered.

## Not covered

- The agent tool (`moodboard` actions) needs a configured model; the throwaway
  profile had none.
- The desktop app shell was not tested; only the web profile.

---

# Live Harness verification — 2026-10-25

Tested in the open DeepSeek Harness desktop app with DeepSeek-V4.1-Flash
(High reasoning), using native UI interactions.

The desktop profile was running Moodboard 0.2.4. Updated it to the local
0.2.5 checkout using `dsh plugin --profile desktop add <checkout>`, then
restarted the plugin. The desktop profile now links to this checkout.

## Verified

- Empty board renders; adding `test/fixtures/harness-light-reference.png`
  through the file picker uploads and displays it.
- Saved tag `harness-test`, source `https://example.com/moodboard-test`, a
  long note, and pinned membership persist across panel navigation.
- Composer Moodboard button inserts the directive without submitting it.
- Gallery tag filtering and a nonmatching search produce the expected empty
  result; clearing search restores the image.
- In chat **Moodboard reference verification check**, actual `active` and
  `get` calls delivered the reference. The agent identified ORBIT ANALYTICS,
  light lavender background, purple accents, rounded cards, metric values
  12,840 / 48 / 86%, and a cyan circle. The first session also used read-only
  pixel sampling through bash.
- `get` delivered the instruction and token at the end of the long notes:
  primary action **Launch preview**, verification token **MARIGOLD-731**.
  The agent distinguished this instruction from the visible button text
  **Create report** and returned the source URL correctly.
- Replacing the pinned reference with
  `test/fixtures/harness-dark-replacement.png` immediately updated the active
  strip, gallery, and inspector. Pin, tags, notes, and source were retained.
- The replacement exposed an additional editor bug: its name field retained
  the previous name and falsely reported unsaved changes. Fixed dirty-state
  comparison to use the last loaded editor snapshot. A regression test covers
  server updates and preservation of real unsaved edits. Reloaded the UI and
  verified both light-to-dark and dark-to-light replacement with the correct
  name and disabled Save/Cancel controls afterward.
- In a fresh chat **Moodboard replacement verification**, trajectory shows
  exactly `active` and `query` with tags `["harness-test"]` followed by the
  response; no bash sampling. The agent correctly described NIGHT METRICS,
  dark navy background, orange accents, square cards, and a green triangle.
  These visual details were not supplied in the prompt or saved notes.
- Disabling and re-enabling the plugin restored the dark reference, tag and
  pin, with its thumbnail displaying correctly. UI reload also retained the
  saved board.

## Automated checks

`npm test`: 22 passing tests, including the new editor regression.
`git diff --check`: passed.

## Limits and remaining state

- No generated application was assessed for visual fidelity.
- No memory profiler or large-board performance test was run.
- Did not quit the entire Harness process; persistence was checked across UI
  reload and host/client plugin restart.
- Clipboard image paste, drag ordering, bulk actions, deletion, and the full
  keyboard/accessibility flow were not exercised in this live run.
- One synthetic dark reference remains pinned on the board under
  `harness-test`, with the long test note. Both verification chats remain
  available in the default workspace.
- This was a live manual verification, not an automated browser test suite.
