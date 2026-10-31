# Moodboard UI redesign — Warm Sand Studio

Status: implementation brief (2026-10-31)
Scope: the plugin's own client UI in `client.js` (panel page, intake dialog,
reference inspector, shared dialogs). No host-side contract changes.

## 1. Page type (Stage 0)

| Field | Value |
|---|---|
| Primary type | B-end content library / visual gallery with a detail inspector |
| Secondary modifier | Form + wizard (Add references intake), detail editor (inspector) |
| Density | Medium |
| Confidence | High |
| Evidence | Image grid with filters, 360px editor column, modal intake form, repeated save/cancel flows, keyboard shortcuts, bulk bar |
| Consequences | Scanability and state clarity first; expressive colour only on primary actions, pinned state and active filters; calm motion; no landing-page hero |

## 2. Direction

Reference Fidelity to the active pinned style guide
(`kastplan-cuberto-home-management`, `kastplan-ultro-layout`,
`kastplan-storage-cream-coral`), translated into the project's own tokens:

- Warm sand canvas, white rounded cards, hairline warm borders.
- ONE coral accent for primary CTAs, active filters, pinned/style-guide state.
- Deep warm ink, generous 4px-based spacing, quiet 10–12px label type.
- 18px cards, 22px dialogs, 12px inputs, pill buttons and chips.
- Friendly geometric sans (SF Pro Rounded → Avenir Next → Nunito fallback),
  tight heading tracking, tabular numerals.
- Soft warm shadows, no harsh black borders.

Everything derives from the host DSH alias tokens through a local
`--mb-host-*` indirection so dark mode keeps working without a theme hook.

## 3. Tokens

The implementation derives surfaces from the harness theme tokens instead of
overriding them, so light and dark both work without a theme hook and no
custom-property cycle is possible:

```
light (computed):  canvas #f6f1e9   card #fffdfa   elevated #fffefd
dark (computed):   canvas #191512   card #1e1b18   elevated #2b2724
coral-500          #e85d2a   icons, rings, active borders (>=3:1 graphics)
coral-600          #c4441a   primary fill, badge fill; 5.0:1 with #fff8f2
coral-700          #a83814   primary hover, link text on light
ink                harness label-primary (warmed 8%)
line               label-primary 11% into canvas; strong 20%
shadow             0 1px 2px rgba(74,48,24,.06), 0 22px 48px -26px rgba(74,48,24,.36)
```

CSS (in the `.dsh-mb-page` block):

```
--mb-canvas:    color-mix(in oklab, var(--dsw-alias-bg-base) 94%, #3a2412 6%)
--mb-card:      color-mix(in oklab, var(--dsw-alias-bg-layer-1) 97%, #d9a15c 3%)
--mb-elevated:  color-mix(in oklab, var(--mb-card) 90%, #ffffff 10%)
--mb-line:      color-mix(in oklab, var(--dsw-alias-label-primary) 11%, var(--mb-canvas))
--mb-line-strong: color-mix(in oklab, var(--dsw-alias-label-primary) 20%, var(--mb-canvas))
--mb-ambient:   color-mix(in oklab, var(--mb-canvas) 86%, #c98b4b 14%)
--mb-accent-ink: color-mix(in oklab, var(--dsw-alias-label-primary) 64%, var(--mb-coral-600) 36%)
--mb-accent-soft: color-mix(in oklab, var(--mb-canvas) 86%, var(--mb-coral-500) 14%)
```

Why this ordering matters: mixing a fixed warm hue into the host backgrounds
would lighten a dark canvas above its own cards, flattening the hierarchy. The
canvas mix therefore uses a *dark* warm brown, which darkens white into cream
in light mode and keeps the canvas below the card in dark mode. Only the brand
tokens are fixed (coral fill + `#fff8f2` text, ~5:1 in both themes):
`--dsw-alias-brand-primary`, `--dsw-alias-button-primary-fill`,
`--dsw-alias-button-primary-hover`, `--dsw-alias-label-primary-inverted`.
An earlier draft that re-declared `--dsw-alias-bg-base` from a same-element
snapshot of itself was a custom-property cycle and is **not** used.

## 4. Type scale

| Role | Size / weight / tracking |
|---|---|
| Page title | 26 / 700 / -0.02em |
| Dialog title | 20 / 650 / -0.015em |
| Section title | 15.5 / 650 |
| Card name | 13 / 600 |
| Body | 13.5 / 400 |
| Hint, meta | 12.5 / 400 |
| Label | 12 / 600 |
| Pill, badge | 11.5 / 600, tabular |
| Kicker | 10.5 / 650 / .08em / uppercase |

## 5. Components

- Buttons: 38px pill, 13px/600. Primary coral-600 fill, `#FFF8F2` text, hover
  coral-700 + 1px lift. Secondary card fill + line border. Ghost icon 36px
  circle. Danger: danger text, danger-wash hover.
- Inputs / textarea / select: 40px, 12px radius, card fill, line-2 border,
  coral focus border + 3px coral 16% ring.
- Switch setting row: white card, icon chip, title + hint left, 44×26 coral
  switch right. Whole row is the button; keyboard focus ring on the row.
- Segmented tabs: wash rail, 6px padding, 999px; active segment card fill,
  coral text, soft shadow; icons 14px.
- Filter chips: 32px pill; active = coral-600 fill + light text (matches the
  active category chip in the pinned product-row reference).
- Cards: 18px radius, image 4:3, name 13/600, tag pills warm wash; hover lift
  2px; selected = 2px coral ring; pin badge coral wash pill.
- Dialog: 22px radius, 640px wide, max-height 88vh, header 20/22 with 40px
  coral-wash icon badge, scrollable body, sticky footer with hairline top.
- Inspector: white card, header with kicker + title + style-guide pill,
  16:10 preview frame, section labels, sticky footer.
- Focus: `2px solid coral-500`, offset 2. Motion: 180ms
  `cubic-bezier(.22,.68,.24,1)`, enter fade/scale .98→1, reduced-motion off.

## 6. Screen fixes

### Add references dialog (attachment 1)

Problems: 90px dead header, oversized empty textarea, helper text repeats the
placeholder, switch reads as a mystery blob, primary submit sits left of the
secondary Done, no feedback while typing, generic monochrome.

Changes (implemented):
1. Header: 40px coral gradient link badge + 20px title + 12.5px subtitle
   ("Paste public links, or search Mobbin and Are.na") + 36px circular close.
2. Tabs: icon segmented control on a warm rail, card-fill active segment with
   accent-ink label.
3. Links: live `{n} / 20 links` counter pill on the label row, 4-row textarea;
   the 1-20 hint moved to the footer so it is not duplicated mid-form.
4. Pin: setting row (coral-soft IconPin chip, label + "becomes the active style
   guide" hint, coral switch right) instead of a bordered mystery toggle.
5. Footer: sticky, left status (mode hint), right `Close` (secondary) then coral
   `Add references` as the right-most primary. Dialog 680px, max 88vh.
6. Results summary: success/neutral/error count pills, readable failure list.

### Reference inspector (attachment 2)

Problems: ~a screen of dead whitespace under the manage row, no grouping,
Copy/Paste metadata forms a flat two-button row, pinned state only visible at
the bottom of a long scroll, footer Save looks like a disabled grey block.

Changes (implemented):
1. Header: kicker row with a solid coral "Style guide" pill when pinned, so the
   title keeps the full width; 36px close button.
2. 16:10 preview frame (contain, warm letterbox).
3. Sections with label + trailing hairline rule: Details (name, tags, notes,
   source), Metadata (copy/paste + status), Style guide (switch row + hint),
   Manage (chevron pair in one pill, Replace, borderless Remove). Manage is
   pushed to the bottom of the scroll area when content is short.
4. Sticky footer: saved/unsaved status + Cancel + coral Save; disabled Save is
   a neutral surface, not a washed-out grey block.
5. Remove keeps its inline confirm.

### Panel page

Header 44px coral mark, 26px title, warm meta pills; active style-guide hero as
a white card with coral wash; toolbar as floating rounded bar; cards, empty
state, lightbox, bulk bar, tag-merge and shortcuts dialogs inherit the tokens.

## 7. Accessibility & i18n

- Coral-600 (`#C4441A`) on white is 5.0:1; on cream 5.2:1. Coral-500 is only
  used for non-text icons/borders (≥3:1) and large fills.
- Every switch keeps `role="switch"` + `aria-checked`; the whole setting row is
  the control. Focus trap, Esc and opener focus return are unchanged.
- All new strings added to both `en` and `zh` dictionaries; key parity test must
  keep passing.
- `prefers-reduced-motion` disables transitions, lift and dialog scale.

## 8. Verification

- `npm test` (client loads, import contract, locale parity).
- Real-render harness under `verification/harness/` renders the actual
  `client.js` components with a stubbed host, screenshots page + dialog +
  inspector in light and dark.
- Contrast check script for the token table.
