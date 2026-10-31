# Visual verification — Warm Sand Studio redesign

Date: 2026-10-31 (client.js mtime 12:15:54)
Task: task-4 · visual verification of the redesigned dsh-moodboard client UI
Harness: `verification/harness/` (real client.js rendered through mini-react + stubbed DSH host)

## Verdict

The redesigned UI renders correctly and the harness stays green: **27/27 render checks passed, 0 page/console errors, 26 screenshots across 1280×900, 1024×768, 768×900 and 390×844**. `npm test` passes **99/99**.

Three defects found, all cosmetic/token-level (no functional regressions):

1. **390×844: the Add references dialog is full-width but not full-screen** (567px tall, vertically centred). The mobile rule sets `width`/`max-height` but no `height`.
2. **Light mode: `.dsh-mb-hint` is 4.30:1** on the warm canvas — below WCAG AA 4.5:1 for 12px body text.
3. **Light mode: `.dsh-mb-import-status` is 4.46:1** on the import footer surface — just below 4.5:1.

Dark mode passes every audited pair.

## Pass / fail table

| Area | State / viewport | Result | Evidence |
|---|---|---|---|
| Page, light | gallery + hero + 3 pinned badges @1280×900 | PASS | [01-page-light.png](../harness/shots/01-page-light.png) |
| Empty board | empty state @1280×900 | PASS | [02-empty-light.png](../harness/shots/02-empty-light.png) |
| Add references | default link tab @1280×900 | PASS | [03-add-references.png](../harness/shots/03-add-references.png) |
| Add references | discover tab @1280×900 | PASS | [04-add-references-discover.png](../harness/shots/04-add-references-discover.png) |
| Add references | 3 links typed → `3 / 20 links`, pin switch ON | PASS | [15-import-links-typed.png](../harness/shots/15-import-links-typed.png) |
| Add references | result summary: Added 1 / Already on board 0 / Failed 1 + failure line | PASS | [16-import-result.png](../harness/shots/16-import-result.png) |
| Add references | “Close” footer label, `Done`→`Close` before coral submit | PASS | 15/16 screenshots |
| Add references | 680px / 88vh at 768×900; body scrolls internally; footer sticky | PASS (body 574 client / 709 scroll; footer 742–809 visible) | [22-import-768-result.png](../harness/shots/22-import-768-result.png) |
| Add references | mobile full-screen @390×844 | **FAIL** — full width 390, radius 0, but only 567px tall (top 138); footer visible at 643–706 | [24-mobile-import.png](../harness/shots/24-mobile-import.png) |
| Inspector | pinned: REFERENCE kicker + solid coral “Style guide” pill + switch on | PASS | [05-inspector.png](../harness/shots/05-inspector.png) |
| Inspector | unpinned: no pill, switch off | PASS | [13-inspector-unpinned.png](../harness/shots/13-inspector-unpinned.png) |
| Inspector | dirty: coral Save enabled + “Unsaved changes” | PASS | [14-inspector-dirty.png](../harness/shots/14-inspector-dirty.png) |
| Inspector | internal scroll body + sticky footer @1280 | PASS | 05/14 screenshots |
| Inspector | DETAILS / METADATA / STYLE GUIDE / MANAGE labels + hairline rules | PASS | [26-inspector-manage.png](../harness/shots/26-inspector-manage.png) |
| Inspector | grouped chevron pill (move pair) + borderless Remove, pushed to bottom | PASS | [26-inspector-manage.png](../harness/shots/26-inspector-manage.png) |
| Shortcuts dialog | open @1280×900 | PASS | [06-shortcuts.png](../harness/shots/06-shortcuts.png) |
| Tag merge | open @1280×900, badge header, `Cancel` before `Merge` | PASS | [07-tag-merge.png](../harness/shots/07-tag-merge.png) |
| Lightbox | double-click card @1280×900 | PASS | [11-lightbox.png](../harness/shots/11-lightbox.png) |
| Bulk selection | ⌘-click two cards, bulk bar | PASS | [12-bulk-selection.png](../harness/shots/12-bulk-selection.png) |
| Dark page | gallery + hero @1280×900 | PASS | [08-page-dark.png](../harness/shots/08-page-dark.png) |
| Dark inspector / dialog | tokens adapted | PASS | [09-inspector-dark.png](../harness/shots/09-inspector-dark.png), [10-add-references-dark.png](../harness/shots/10-add-references-dark.png) |
| Focus state | Tab → visible coral ring in dialog | PASS | [17-focus-ring.png](../harness/shots/17-focus-ring.png) |
| Esc + focus return | dialog closes, focus returns to header “Add from link” opener | PASS | automated check |
| 1024×768 | no horizontal overflow / clipped controls | PASS | [18-page-1024-light.png](../harness/shots/18-page-1024-light.png) |
| 1024×768 | inspector becomes bottom sheet, footer visible | PASS | [19-inspector-sheet-1024.png](../harness/shots/19-inspector-sheet-1024.png) |
| 768×900 | no horizontal overflow / clipped controls | PASS | [20-page-768-light.png](../harness/shots/20-page-768-light.png) |
| 768×900 | inspector bottom sheet, footer visible | PASS | [21-inspector-sheet-768.png](../harness/shots/21-inspector-sheet-768.png) |
| 390×844 | no horizontal overflow / clipped controls | PASS | [23-page-390-light.png](../harness/shots/23-page-390-light.png) |
| 390×844 | inspector bottom sheet, footer visible | PASS | [25-mobile-inspector-sheet.png](../harness/shots/25-mobile-inspector-sheet.png) |
| Contrast | white-on-coral, accent-ink, labels, hints (light + dark) | 14/16 PASS, 2 FAIL (light hints) | table below |
| `npm test` | node checks + 3 suites | PASS 99/99, fail 0 | run output, 2026-10-31 |

## Defects with selector + suggested fix

### D1 — Mobile import dialog is not full-screen (cosmetic, spec mismatch)

- **Where:** `@media (max-width: 640px) .dsh-mb-merge-dialog` (`.dsh-mb-import-dialog` in the DOM).
- **Measured:** 390×844 viewport → dialog `width: 390px`, `border-radius: 0`, but `height: 567px`, `top: 138px`; body does not need to scroll because it fits.
- **Evidence:** [24-mobile-import.png](../harness/shots/24-mobile-import.png).
- **Suggested fix:** add an explicit height for the import dialog inside the existing 640px rule:

  ```css
  @media (max-width: 640px) {
    .dsh-mb-import-dialog { height: 100%; max-height: 100%; }
  }
  ```

  Scope it to `.dsh-mb-import-dialog` so the shortcut/tag-merge dialogs keep their compact sizing. `height: 100dvh` is an alternative if the overlay's height is ambiguous.

### D2 — Light-mode secondary hint text under AA (4.30:1)

- **Where:** `.dsh-mb-hint { color: var(--dsw-alias-label-secondary) }` on `--mb-canvas` (e.g. “Drag a card to reorder the gallery”, search results line, loading/helper hints). 12px body text.
- **Measured:** `#6E6E73` on `#EDECEA` → **4.30:1** (needs 4.5:1).
- **Evidence:** [01-page-light.png](../harness/shots/01-page-light.png), console.json contrast row.
- **Suggested fix:** add a page-scoped secondary ink and use it for hints (dark mode remains fine because `label-primary` lightens):

  ```css
  .dsh-mb-page {
    --mb-ink-2: color-mix(in oklab, var(--dsw-alias-label-secondary) 90%, var(--dsw-alias-label-primary) 10%);
  }
  .dsh-mb-hint, .dsh-mb-import-status { color: var(--mb-ink-2); }
  ```

  Computed check for this mix: ≈**5.08:1** on canvas and ≈**5.28:1** on the import footer (both themes), while keeping the warm secondary look.

### D3 — Light-mode import footer hint under AA (4.46:1)

- **Where:** `.dsh-mb-import-status` (footer helper: “1–20 public page or image links…”) on `.dsh-mb-import-foot` (`color-mix(canvas 74%, card 26%)`).
- **Measured:** `#6E6E73` on `#F2F0EE` → **4.46:1** (needs 4.5:1).
- **Evidence:** [03-add-references.png](../harness/shots/03-add-references.png), contrast row.
- **Suggested fix:** same `--mb-ink-2` token as D2. If the token change is undesirable, darken `--dsw-alias-label-secondary` only inside `.dsh-mb-page` by ~6%.

## Contrast audit (computed, not estimated)

Method: the harness reads **computed** colours from the rendered page in Chrome, resolves `color-mix()`/`oklab()` to sRGB (including OKLab→sRGB conversion), and applies the WCAG relative-luminance formula in `capture.mjs`. Threshold: 4.5:1 for body text (<18.66px regular / <14px bold), 3:1 for large text/non-text. All audited items here are body/label text, so 4.5:1 is used.

| Pair (theme) | Foreground | Background | Ratio | Result |
|---|---|---|---|---|
| Primary CTA text on coral-600 (light) | `#FFF8F2` | `#C4441A` | **4.77:1** | PASS |
| Active filter chip text on coral-600 (light) | `#FFF8F2` | `#C4441A` | **4.77:1** | PASS |
| Style-guide pill text on coral-600 (light) | `#FFF8F2` | `#C4441A` | **4.77:1** | PASS |
| accent-ink mix on card (light) | `#552D24` | `#FEFCFA` | **11.48:1** | PASS |
| Inspector kicker on elevated card (light) | `#552D24` | `#FEFCFB` | **11.49:1** | PASS |
| Section label on elevated card (light) | `#6E6E73` | `#FEFCFB` | **4.96:1** | PASS |
| Secondary hint on canvas (light) | `#6E6E73` | `#EDECEA` | **4.30:1** | **FAIL** (D2) |
| Import footer hint on footer (light) | `#6E6E73` | `#F2F0EE` | **4.46:1** | **FAIL** (D3) |
| Primary CTA text on coral-600 (dark) | `#FFF8F2` | `#C4441A` | **4.77:1** | PASS |
| Active filter chip text on coral-600 (dark) | `#FFF8F2` | `#C4441A` | **4.77:1** | PASS |
| Style-guide pill text on coral-600 (dark) | `#FFF8F2` | `#C4441A` | **4.77:1** | PASS |
| accent-ink mix on card (dark) | `#EAB8AA` | `#1F1D1E` | **9.53:1** | PASS |
| Inspector kicker on elevated card (dark) | `#EAB8AA` | `#313031` | **7.47:1** | PASS |
| Section label on elevated card (dark) | `#A1A1A6` | `#313031` | **5.11:1** | PASS |
| Secondary hint on canvas (dark) | `#A1A1A6` | `#131211` | **7.27:1** | PASS |
| Import footer hint on footer (dark) | `#A1A1A6` | `#161515` | **7.09:1** | PASS |

Note: the earlier design note said white-on-coral “keeps ~5:1”; the measured value is 4.77:1. It still passes AA for normal text, but there is little headroom — keep `#FFF8F2` on `#C4441A` (or darker) and do not lighten the coral for text-bearing fills.

## Behavior checks

- **Focus:** Tab from the dialog's close button lands on the tag input with a visible coral `:focus-visible` ring (2px) and white/coral shadow — [17-focus-ring.png](../harness/shots/17-focus-ring.png).
- **Esc / focus return:** after Escape the dialog is removed and `document.activeElement` is the header “Add from link” button (automated assertion).
- **Dialog scroll + sticky footer:** at 768×900 with a result summary, `.dsh-mb-merge-body` has `overflow-y: auto`, 574px client vs 709px scroll, and `.dsh-mb-import-foot` stays at 742–809px (above the 900px viewport bottom).
- **No overflow:** `documentElement`/`.dsh-mb-page` report no horizontal overflow and no header/dialog/inspector footer control extends past the viewport at 1280, 1024, 768 or 390.
- **Bottom sheet:** at ≤1024 the inspector is `position: fixed` with a working dim scrim (background header pixels drop from ~231 to ~152 mean brightness), internal body scroll and a reachable footer at 1024, 768 and 390.
- **Dark tokens:** hero, cards, inspector, dialogs, chips and badges all adapt; coral fills stay fixed with light text (4.77:1) while dark surfaces mix to warm charcoal.

## Requested changes confirmed

- Inspector header kicker row + solid coral “Style guide” pill — yes (05/14).
- DETAILS / METADATA / STYLE GUIDE / MANAGE labels with trailing hairline rules — yes (26).
- Grouped chevron pill + borderless Remove pushed to the bottom — yes (26).
- `--mb-elevated` dialogs — yes (03/07/22).
- Tag-merge badge + `Cancel` before `Merge` — yes (07).
- Import dialog “Close” footer label — yes (15/16).
- Toolbar search + chips share one row at 1280 — yes (01).
- Import dialog 680px / 88vh — yes at 1280/768/1024; mobile height gap is D1.

## Observations (non-blocking)

- At 390×844 the `★` star link wraps onto its own centred row below the header actions; cosmetic only. Consider hiding it at ≤640 or keeping it on the action row.
- The 390 header drops button text to icons, as designed; all controls remain ≥32px and reachable.
- At 1024×768 the inspector sheet covers most of the viewport; header stays visible and the sheet footer is reachable.

## Reproduce

```bash
cd "/Users/stijnus/Developer/GitHub/Deepseek Plugins/dsh-moodboard"
node verification/harness/capture.mjs          # renders + asserts + writes shots/console.json
npm test                                      # 99/99 pass
```

`verification/harness/shots/console.json` is the machine-readable run report: all 27 checks, 26 shot records with viewport sizes, `pageErrors: 0`, the 16 contrast rows, and `defects[]`.

## Scope / limitations

Only `verification/harness/` (capture + shots) and this report were written; `client.js`, `index.js`, `sources.js`, `docs/`, `test/`, `package.json` and `README.md` were not edited. Host fidelity limits are documented in `verification/harness/REPORT.md`: representative DSH alias token values (not a live theme read), no DSH sidebar/composer chrome, system Chrome rather than the app's bundled Chromium, paused animations, and stubbed persistence/upload/clipboard/live-sync.

## Post-fix re-check (2026-10-31 12:27, client.js mtime 12:25:43)

Re-ran `node verification/harness/capture.mjs` against the fixed `client.js`.

**Result: PASS — 27/27 checks, 0 page/console errors, 0 contrast pairs under threshold, `defects: []`.** All 26 screenshots were regenerated; `verification/harness/shots/console.json` is the machine evidence for this run.

| Defect | Before | After | Result |
|---|---|---|---|
| D1 mobile import not full-height | 390×844 dialog was 567px tall at top 138, footer 643–706 | dialog **390×844 at top 0**, radius 0, footer 781–844, body 694/694 (content fits, no clipping) | **FIXED** — [24-mobile-import.png](../harness/shots/24-mobile-import.png) |
| D2 light `.dsh-mb-hint` | 4.30:1 (`#6E6E73` on `#EDECEA`) | **5.14:1** (`#626267` on `#EDECEA`) | **FIXED** (AA pass) |
| D3 light `.dsh-mb-import-status` | 4.46:1 (`#6E6E73` on `#F2F0EE`) | **5.34:1** (`#626267` on `#F2F0EE`) | **FIXED** (AA pass) |

Dark-mode hints improved as a side effect of `--mb-ink-2` and remain comfortably above AA: hint **8.27:1** (was 7.27), import footer hint **8.06:1** (was 7.09). The white-on-coral CTA (4.77:1), accent-ink 11.48/9.53:1 and section labels 4.96/5.11:1 are unchanged and still pass.

No new defects introduced. The 768×900 import dialog still renders 680×720 with internal scroll (574 client / 709 scroll) and a sticky footer at 742–809, and all responsive overflow / focus / Esc / bottom-sheet / dark-token checks stayed green.

Final state: **redesign visually verified, AA text contrast clean in both themes, mobile import full-screen.**

Follow-up after this re-check: the non-blocking ★ header-link wrap at 390×844 was fixed by hiding that suite link below 640px. A fresh harness run against the final `client.js` reported 27/27 checks, 0 page/console errors and 0 contrast failures; `shots/console.json` is the committed machine evidence (PNGs are regenerated locally and not committed).
