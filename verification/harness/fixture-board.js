/**
 * fixture-board.js — deterministic board fixture for the real-render harness.
 *
 * Shapes follow docs/CONTRACT.md (`BoardView` / `ImageView`). Image bytes are
 * served from verification/harness/fixtures via the fetch stub in host-stub.js,
 * so the page exercises its real `/moodboard/image/<id>` blob pipeline.
 *
 * Images are neutral reference screenshots generated from repo assets
 * (docs/panel.jpg, docs/import-dialog.jpg) plus test/fixtures/*.png. They are
 * only fixtures, not user data.
 */
;(function () {
  'use strict'

  const image = (id, name, tags, notes, sourceUrl, pinned, order, file) => ({
    id,
    name,
    tags,
    notes,
    sourceUrl,
    pinned,
    order,
    createdAt: `2026-10-2${order}T1${order}:0${order}:00.000Z`,
    updatedAt: `2026-10-2${order}T1${order}:0${order}:00.000Z`,
    mediaType: 'image/jpeg',
    bytes: 0,
    width: 900,
    height: 675,
    imageUrl: `/moodboard/image/${id}`,
    __file: file,
  })

  const images = [
    image(
      'mb_5a1c9e7d2f10',
      'kastplan-cuberto-home-management.jpg',
      ['kastplan', 'new-ui', 'primary', 'layout', 'palette'],
      'PRIMARY DIRECTION ANCHOR — Dribbble “Home management app UI design” by Cuberto. Borrow the warm sand canvas, rounded white cards, generous 4px spacing rhythm and the single coral primary action. Avoid the brand mark and the illustration style.',
      'https://dribbble.com/shots/21031939-Home-management-app-UI-design',
      true,
      0,
      'fixtures/reference-layout.jpg',
    ),
    image(
      'mb_7b2d4f90c3a1',
      'kastplan-ultro-layout.jpg',
      ['kastplan', 'new-ui', 'layout', 'typography', 'detail'],
      'Layout + typography reference — “Ultro — Control Smart Home Devices”. Use the deep warm ink, quiet 10–12px labels with tight tracking, pill segments and tabular numerals.',
      'https://dribbble.com/shots/20268452-Ultro-Control-Smart-Home-Devices',
      true,
      1,
      'fixtures/reference-inspector.jpg',
    ),
    image(
      'mb_3e8a1c5b6d20',
      'kastplan-storage-cream-coral.jpg',
      ['kastplan', 'new-ui', 'palette', 'storage'],
      'Palette and storage-card reference: cream surfaces, white cards, and ONE coral fill reserved for primary actions. Keep shadows soft and warm, borders hairline.',
      'https://dribbble.com/shots/21031939-Home-management-app-UI-design',
      true,
      2,
      'fixtures/reference-intake-form.jpg',
    ),
    image(
      'mb_9f4b2e6a8c30',
      'harness-light-reference.png',
      ['harness', 'light', 'reference'],
      'Harness light-theme reference capture used by the automated render check. Confirms the page renders with the real host alias tokens at 1280×900.',
      'https://example.com/moodboard-harness',
      false,
      3,
      'fixtures/reference-harness-light.jpg',
    ),
    image(
      'mb_2c7d9b1e4a50',
      'harness-dark-replacement.png',
      ['harness', 'dark', 'reference'],
      'Harness dark-theme reference capture. Verify dark-mode contrast and token mixing before shipping the redesigned surfaces.',
      'https://example.com/moodboard-harness',
      false,
      4,
      'fixtures/reference-harness-dark.jpg',
    ),
    image(
      'mb_6d1a8f3c2b40',
      'import-dialog-before.png',
      ['intake', 'modal', 'form'],
      'Current Add references dialog: a dead header, an oversized empty textarea, the switch reads as a mystery blob and the primary submit sits left of Done.',
      'https://example.com/moodboard-import',
      false,
      5,
      'fixtures/reference-intake.jpg',
    ),
  ]

  const board = {
    version: 1,
    updatedAt: '2026-10-27T11:30:00.000Z',
    images: images.map((entry) => {
      const copy = Object.assign({}, entry)
      delete copy.__file
      return copy
    }),
    allTags: ['kastplan', 'new-ui', 'primary', 'layout', 'palette', 'typography', 'detail', 'storage', 'harness', 'light', 'dark', 'reference', 'intake', 'modal', 'form'],
    tagCounts: {},
  }

  const files = {}
  for (const entry of images) files[entry.id] = entry.__file

  for (const entry of board.images) {
    for (const tag of entry.tags) board.tagCounts[tag] = (board.tagCounts[tag] || 0) + 1
  }

  window.HARNESS_FIXTURE = {
    revision: 7,
    updatedAt: board.updatedAt,
    board,
    files,
    sources: {
      ok: true,
      sources: [
        {
          id: 'web',
          kind: 'capture',
          label: 'Any link',
          available: true,
          detail: 'Capture a public page preview or an image URL.',
        },
        {
          id: 'mobbin',
          kind: 'search',
          label: 'Mobbin',
          available: false,
          detail: 'Set MOBBIN_API_KEY (Team/Enterprise) to search Mobbin screens.',
          platforms: ['ios', 'web'],
        },
        {
          id: 'arena',
          kind: 'search',
          label: 'Are.na',
          available: true,
          detail: 'Public Are.na search, no key needed.',
          platforms: ['ios', 'web'],
        },
        {
          id: 'dribbble',
          kind: 'browser',
          label: 'Dribbble',
          available: false,
          detail: 'Use the browser capture workflow and add local screenshots.',
        },
      ],
      workflow:
        'Inspiration intake workflow:\n1. Collect public links or search Mobbin / Are.na.\n2. Add the strongest references to the board and pin the active style guide.\n3. Call the moodboard tool with action="active" before designing UI.',
      configPath: '/Users/stijnus/.dsh/moodboard/sources.json',
    },
  }
})()
