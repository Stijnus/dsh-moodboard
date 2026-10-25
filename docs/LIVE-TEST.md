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
