/**
 * capture.mjs — screenshot the REAL dsh-moodboard client UI.
 *
 * Renders client.js through mini-react.js under the stubbed DSH host, drives
 * the captured `main` slot component in headless Chrome, and writes PNGs plus
 * a console report into verification/harness/shots/.
 *
 * Run:
 *   node verification/harness/capture.mjs
 *
 * Environment notes:
 *   - playwright-cli's default session cache is not writable in this sandbox,
 *     so this script drives the bundled playwright-core directly with
 *     HOME relocated to /tmp/pwhome and the system Google Chrome channel. No
 *     browser download is needed. Override the binary with HARNESS_CHANNEL.
 *   - A static server is started on 127.0.0.1 (port 4173, or an ephemeral port
 *     when 4173 is busy) because the page fetches image blobs and client.js.
 *
 * Exit code 0 only when every screenshot rendered with no page/console errors.
 */
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startHarnessServer } from './serve.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHOTS = resolve(HERE, 'shots')
const PAGE = '/verification/harness/index.html'

// Relocate HOME before loading playwright-core: the sandbox denies writes to
// ~/Library/Caches/ms-playwright, and Chrome should keep its profile in /tmp.
const HARNESS_HOME = process.env.HARNESS_HOME || '/tmp/pwhome'
process.env.HOME = HARNESS_HOME
await mkdir(resolve(HARNESS_HOME, 'Library/Caches/ms-playwright'), { recursive: true })
await mkdir(SHOTS, { recursive: true })

const require = createRequire(import.meta.url)
const PLAYWRIGHT_CANDIDATES = [
  process.env.HARNESS_PLAYWRIGHT_CORE,
  '/Users/stijnus/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs',
  'playwright-core/index.mjs',
  'playwright-core',
].filter((candidate) => typeof candidate === 'string' && candidate !== '')

let chromium = null
const loadErrors = []
for (const candidate of PLAYWRIGHT_CANDIDATES) {
  try {
    const mod = await import(candidate.startsWith('/') ? candidate : require.resolve(candidate))
    const value = mod.chromium || (mod.default && mod.default.chromium)
    if (value !== undefined && typeof value.launch === 'function') {
      chromium = value
      break
    }
    loadErrors.push(`${candidate}: module has no chromium export`)
  } catch (error) {
    loadErrors.push(`${candidate}: ${error && error.message ? error.message : error}`)
  }
}
if (chromium === null) {
  console.error('[capture] could not load playwright-core:')
  for (const line of loadErrors) console.error('  -', line)
  process.exit(1)
}

const preferredPort = Number.parseInt(process.env.HARNESS_PORT || '4173', 10)
let serving = null
for (const port of [Number.isFinite(preferredPort) ? preferredPort : 4173, 0]) {
  try {
    serving = await startHarnessServer(port)
    break
  } catch (error) {
    if (port === 0) throw error
  }
}
const baseUrl = serving.url
console.log(`[capture] harness server ${baseUrl}`)

const consoleMessages = []
let pageErrors = 0

function attachDiagnostics(page) {
  page.on('console', (message) => {
    const entry = { type: message.type(), text: message.text(), location: message.location() }
    consoleMessages.push(entry)
    if (entry.type === 'error') pageErrors += 1
  })
  page.on('pageerror', (error) => {
    pageErrors += 1
    consoleMessages.push({ type: 'pageerror', text: error.message, stack: error.stack })
  })
}

async function settle(page) {
  await page.waitForFunction(() => window.HARNESS !== undefined && window.HARNESS.ready === true, null, {
    timeout: 20000,
  })
  await page.evaluate(() => window.HARNESS.settle(180))
}

async function goto(page, query) {
  await page.goto(`${baseUrl}${PAGE}${query || ''}`, { waitUntil: 'load' })
  await settle(page)
}

async function shot(page, name) {
  const path = resolve(SHOTS, name)
  await page.screenshot({ path, animations: 'disabled', caret: 'hide' })
  const viewport = page.viewportSize()
  shots.push({ name, width: viewport === null ? null : viewport.width, height: viewport === null ? null : viewport.height })
  console.log(`[capture] wrote ${name}`)
  return path
}

async function snapshot(page) {
  return page.evaluate(() => window.HARNESS.snapshot())
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

const checks = []
const shots = []
function record(name, snapshotValue, predicate) {
  const ok = predicate(snapshotValue)
  checks.push({ name, ok, snapshot: snapshotValue })
  if (!ok) throw new Error(`capture check failed: ${name}`)
}

async function setViewport(page, width, height) {
  await page.setViewportSize({ width, height })
  await page.evaluate(() => window.HARNESS && window.HARNESS.settle(80)).catch(() => {})
}

/** Horizontal overflow / clipped-control audit for one rendered viewport. */
async function layoutAudit(page) {
  return page.evaluate(() => {
    const root = document.documentElement
    const pageEl = document.querySelector('.dsh-mb-page')
    const controls = Array.prototype.slice.call(
      document.querySelectorAll(
        '.dsh-mb-header-actions button, .dsh-mb-header-actions a, .dsh-mb-import-foot button, .dsh-mb-details-foot button',
      ),
    )
    const clipped = controls
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && (rect.right > window.innerWidth + 1 || rect.left < -1)
      })
      .map((element) => ({
        label: element.getAttribute('aria-label') || (element.textContent || '').trim().slice(0, 40),
        rect: (() => {
          const rect = element.getBoundingClientRect()
          return { left: Math.round(rect.left), right: Math.round(rect.right) }
        })(),
      }))
    const pageRect = pageEl.getBoundingClientRect()
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentOverflow: root.scrollWidth > root.clientWidth + 1,
      pageOverflow: pageEl.scrollWidth > pageEl.clientWidth + 1,
      pageWidth: Math.round(pageRect.width),
      clippedControls: clipped,
    }
  })
}

/** Import-dialog internal scroll + sticky footer geometry. */
async function dialogAudit(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    if (dialog === null) return null
    const body = dialog.querySelector('.dsh-mb-merge-body')
    const foot = dialog.querySelector('.dsh-mb-import-foot') || dialog.querySelector('.dsh-mb-details-foot')
    const dialogRect = dialog.getBoundingClientRect()
    const footRect = foot === null ? null : foot.getBoundingClientRect()
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      dialog: {
        left: Math.round(dialogRect.left),
        top: Math.round(dialogRect.top),
        width: Math.round(dialogRect.width),
        height: Math.round(dialogRect.height),
        borderRadius: getComputedStyle(dialog).borderRadius,
      },
      body: {
        clientHeight: body.clientHeight,
        scrollHeight: body.scrollHeight,
        scrolls: body.scrollHeight > body.clientHeight + 1,
        overflowY: getComputedStyle(body).overflowY,
      },
      footer: {
        top: Math.round(footRect.top),
        bottom: Math.round(footRect.bottom),
        visible: footRect.top >= 0 && footRect.bottom <= window.innerHeight + 1,
        position: foot === null ? null : getComputedStyle(foot).position,
      },
    }
  })
}

/** Computed colours for the accessibility pairs we audit (never parsed by hand). */
async function collectContrast(page, options) {
  return page.evaluate((settings) => {
    const read = (selector, property) => {
      const element = document.querySelector(selector)
      if (element === null) return null
      return getComputedStyle(element)[property]
    }
    const pageEl = document.querySelector('.dsh-mb-page')
    if (pageEl === null) return null
    const probe = (declaration) => {
      const node = document.createElement('span')
      node.style.cssText = `position:absolute;left:-9999px;top:0;${declaration}`
      pageEl.appendChild(node)
      const style = getComputedStyle(node)
      const result = { color: style.color, background: style.backgroundColor }
      node.remove()
      return result
    }
    const primary = document.querySelector('.dsh-mb-btn--primary')
    const chip = document.querySelector('.dsh-mb-chip[aria-pressed="true"]')
    const pill = document.querySelector('.dsh-mb-details-pill')
    const details = document.querySelector('.dsh-mb-details')
    return {
      theme: settings.theme,
      pageBg: getComputedStyle(pageEl).backgroundColor,
      cardBg: probe('background: var(--mb-card)').background,
      elevatedBg: probe('background: var(--mb-elevated)').background,
      accentInk: probe('color: var(--mb-accent-ink)').color,
      primary: primary === null ? null : { color: getComputedStyle(primary).color, background: getComputedStyle(primary).backgroundColor },
      chip: chip === null ? null : { color: getComputedStyle(chip).color, background: getComputedStyle(chip).backgroundColor },
      pill: pill === null ? null : { color: getComputedStyle(pill).color, background: getComputedStyle(pill).backgroundColor },
      kicker:
        details === null
          ? null
          : {
              color: read('.dsh-mb-details-kicker', 'color'),
              background: getComputedStyle(details).backgroundColor,
            },
      sectionLabel:
        details === null
          ? null
          : {
              color: read('.dsh-mb-details-section-label', 'color'),
              background: getComputedStyle(details).backgroundColor,
            },
      hint: {
        color: read('.dsh-mb-hint', 'color'),
        background: getComputedStyle(pageEl).backgroundColor,
      },
      importStatus:
        document.querySelector('.dsh-mb-import-status') === null
          ? null
          : {
              color: read('.dsh-mb-import-status', 'color'),
              background: read('.dsh-mb-import-foot', 'backgroundColor'),
            },
    }
  }, options)
}

function linearToSrgb(value) {
  if (value <= 0.0031308) return value * 12.92
  return 1.055 * value ** (1 / 2.4) - 0.055
}

function oklabToRgb(lightness, a, b) {
  const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b
  const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b
  const s_ = lightness - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return linear.map((channel) => Math.round(Math.min(255, Math.max(0, linearToSrgb(channel) * 255))))
}

/**
 * Parse any computed CSS colour Chromium returns for this page. color-mix() and
 * oklab() values come back as `oklab(L a b)`, so both that and rgb()/rgba() are
 * supported; the ratio math itself always happens in sRGB.
 */
function parseRgb(value) {
  const text = String(value || '').trim()
  const rgbMatch = /^rgba?\(([^)]+)\)$/.exec(text)
  if (rgbMatch !== null) {
    const parts = rgbMatch[1].split(/[\s,/]+/).filter((part) => part !== '').map(Number)
    if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
  }
  const oklabMatch = /^oklab\(([^)]+)\)$/.exec(text)
  if (oklabMatch !== null) {
    const parts = oklabMatch[1].split(/[\s/]+/).filter((part) => part !== '')
    const numbers = parts.map((part) => (part.endsWith('%') ? Number(part.slice(0, -1)) / 100 : Number(part)))
    if (numbers.length < 3 || numbers.slice(0, 3).some((part) => !Number.isFinite(part))) return null
    const [r, g, b] = oklabToRgb(numbers[0], numbers[1], numbers[2])
    return { r, g, b, a: numbers.length > 3 && Number.isFinite(numbers[3]) ? numbers[3] : 1 }
  }
  const srgbMatch = /^color\(srgb ([^)]+)\)$/.exec(text)
  if (srgbMatch !== null) {
    const parts = srgbMatch[1].split(/[\s/]+/).filter((part) => part !== '').map(Number)
    if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null
    return { r: parts[0] * 255, g: parts[1] * 255, b: parts[2] * 255, a: parts.length > 3 ? parts[3] : 1 }
  }
  return null
}

function composite(fg, backdrop) {
  if (fg === null) return null
  if (fg.a >= 1) return fg
  if (backdrop === null) return fg
  return {
    r: fg.r * fg.a + backdrop.r * (1 - fg.a),
    g: fg.g * fg.a + backdrop.g * (1 - fg.a),
    b: fg.b * fg.a + backdrop.b * (1 - fg.a),
    a: 1,
  }
}

function luminance(color) {
  const channel = (value) => {
    const normalized = value / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

function contrastRatio(foreground, background) {
  const bg = parseRgb(background)
  const fg = composite(parseRgb(foreground), bg)
  if (fg === null || bg === null) return null
  const light = Math.max(luminance(fg), luminance(bg))
  const dark = Math.min(luminance(fg), luminance(bg))
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100
}

const browser = await chromium.launch({ channel: process.env.HARNESS_CHANNEL || 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const page = await context.newPage()
attachDiagnostics(page)
const diagnostics = { contrast: [], contrastFailures: 0, defects: [], import768: null, mobileImport: null }

try {
  // ------------------------------------------------------------------ light
  await goto(page)
  let state = await snapshot(page)
  record('page-light: gallery + hero + pinned badges', state, (value) => value.cards === 6 && value.hero && value.pinnedBadges === 3)
  await shot(page, '01-page-light.png')

  // --------------------------------------------------------------- empty
  await goto(page, '?board=empty')
  state = await snapshot(page)
  record('empty-light: empty state, no gallery', state, (value) => value.cards === 0 && value.empty === true)
  await shot(page, '02-empty-light.png')

  // ------------------------------------------------------------ import
  await goto(page)
  await page.locator('button[aria-label="Add from link"]').first().click()
  await page.waitForSelector('[role="dialog"].dsh-mb-import-dialog')
  state = await snapshot(page)
  record('add-references dialog open', state, (value) => value.dialogs.some((dialog) => dialog.title === 'Add references'))
  await shot(page, '03-add-references.png')

  // Discover tab inside the same dialog.
  await page.locator('[role="dialog"] .dsh-mb-import-mode').nth(1).click()
  await page.waitForTimeout(300)
  await page.evaluate(() => window.HARNESS.settle(120))
  await shot(page, '04-add-references-discover.png')

  // ------------------------------------------------------------ inspector
  await goto(page)
  await page.locator('.dsh-mb-thumb-btn').first().click()
  await page.waitForSelector('.dsh-mb-details')
  state = await snapshot(page)
  record('inspector open with metadata', state, (value) => value.inspector === true && typeof value.inspectorTitle === 'string' && value.inspectorTitle.length > 0)
  const inspectorLayout = await page.evaluate(() => {
    const foot = document.querySelector('.dsh-mb-details-foot')
    const body = document.querySelector('.dsh-mb-details-body')
    const rect = foot.getBoundingClientRect()
    return {
      footerVisible: rect.top >= 0 && rect.bottom <= window.innerHeight + 1,
      bodyOverflowY: getComputedStyle(body).overflowY,
      bodyScrolls: body.scrollHeight > body.clientHeight + 1,
    }
  })
  record('inspector: internal scroll body + reachable sticky footer', inspectorLayout, (value) => value.footerVisible === true && value.bodyOverflowY === 'auto')
  await shot(page, '05-inspector.png')

  // ------------------------------------------------------------ shortcuts
  await goto(page)
  await page.locator('button[aria-label="Keyboard shortcuts"]').first().click()
  await page.waitForSelector('[role="dialog"] .dsh-mb-shortcut-list')
  state = await snapshot(page)
  record('keyboard shortcuts dialog', state, (value) => value.dialogs.some((dialog) => dialog.title === 'Keyboard shortcuts'))
  await shot(page, '06-shortcuts.png')

  // ------------------------------------------------------------- tag merge
  await goto(page)
  await page.locator('button[aria-label="Merge tags"]').first().click()
  await page.waitForSelector('[role="dialog"] .dsh-mb-merge-list')
  state = await snapshot(page)
  record('tag merge dialog', state, (value) => value.dialogs.some((dialog) => dialog.title === 'Merge tags'))
  await shot(page, '07-tag-merge.png')

  // ------------------------------------------------------------------ dark
  await goto(page, '?theme=dark')
  state = await snapshot(page)
  record('page-dark: gallery + hero', state, (value) => value.cards === 6 && value.hero === true)
  await shot(page, '08-page-dark.png')

  await page.locator('.dsh-mb-thumb-btn').first().click()
  await page.waitForSelector('.dsh-mb-details')
  await page.evaluate(() => window.HARNESS.settle(150))
  await shot(page, '09-inspector-dark.png')

  await goto(page, '?theme=dark')
  await page.locator('button[aria-label="Add from link"]').first().click()
  await page.waitForSelector('[role="dialog"].dsh-mb-import-dialog')
  await page.evaluate(() => window.HARNESS.settle(150))
  await shot(page, '10-add-references-dark.png')

  // --------------------------------------------------------------- lightbox
  await goto(page)
  await page.locator('.dsh-mb-thumb-btn').first().dblclick()
  await page.waitForSelector('.dsh-mb-lightbox')
  await page.evaluate(() => window.HARNESS.settle(150))
  state = await snapshot(page)
  record('lightbox preview open', state, (value) => value.lightbox === true)
  await shot(page, '11-lightbox.png')

  // --------------------------------------------------------- bulk selection
  await goto(page)
  await page.locator('.dsh-mb-thumb-btn').nth(0).click({ modifiers: ['Meta'] })
  await page.locator('.dsh-mb-thumb-btn').nth(1).click({ modifiers: ['Meta'] })
  await page.waitForSelector('.dsh-mb-bulk')
  state = await snapshot(page)
  record('bulk selection toolbar', state, (value) => value.bulk === true && value.selectedCards === 2)
  await shot(page, '12-bulk-selection.png')

  // ------------------------------------------------- unpinned inspector state
  await goto(page)
  await page.locator('button[aria-label="Select harness-light-reference.png"]').click()
  await page.waitForSelector('.dsh-mb-details')
  await page.evaluate(() => window.HARNESS.settle(120))
  const unpinned = await page.evaluate(() => {
    const details = document.querySelector('.dsh-mb-details')
    const switcher = details.querySelector('.dsh-mb-switch')
    return {
      hasPill: details.querySelector('.dsh-mb-details-pill') !== null,
      switchChecked: switcher === null ? null : switcher.getAttribute('aria-checked'),
      title: (details.querySelector('.dsh-mb-details-title') || {}).textContent || null,
    }
  })
  record('inspector unpinned: no style-guide pill, switch off', unpinned, (value) => value.hasPill === false && value.switchChecked === 'false')
  await shot(page, '13-inspector-unpinned.png')

  // ---------------------------------------------------- pinned + dirty state
  await goto(page)
  await page.locator('.dsh-mb-thumb-btn').first().click()
  await page.waitForSelector('.dsh-mb-details')
  const pinnedState = await page.evaluate(() => ({
    hasPill: document.querySelector('.dsh-mb-details-pill') !== null,
    switchChecked: (document.querySelector('.dsh-mb-details .dsh-mb-switch') || { getAttribute: () => null }).getAttribute('aria-checked'),
  }))
  record('inspector pinned: coral style-guide pill + switch on', pinnedState, (value) => value.hasPill === true && value.switchChecked === 'true')
  const nameInput = page.locator('.dsh-mb-details .dsh-mb-field input.dsh-mb-input').first()
  await nameInput.fill('kastplan-cuberto-home-management — warm sand')
  await page.waitForTimeout(250)
  await page.evaluate(() => window.HARNESS.settle(100))
  const dirtyState = await page.evaluate(() => {
    const foot = document.querySelector('.dsh-mb-details-foot')
    const save = foot.querySelector('.dsh-mb-btn--primary')
    return {
      saveDisabled: save.disabled,
      saveText: (save.textContent || '').trim(),
      saveBackground: getComputedStyle(save).backgroundColor,
      dirtyLabel: (foot.querySelector('.dsh-mb-dirty') || {}).textContent || null,
    }
  })
  record(
    'inspector dirty: coral Save enabled + unsaved marker',
    dirtyState,
    (value) => value.saveDisabled === false && value.saveText === 'Save' && value.dirtyLabel !== null,
  )
  await shot(page, '14-inspector-dirty.png')

  // ------------------------------------------ import dialog: typed + pin on
  await goto(page)
  await page.locator('button[aria-label="Add from link"]').first().click()
  await page.waitForSelector('[role="dialog"].dsh-mb-import-dialog')
  await page.locator('[role="dialog"] .dsh-mb-import-panel textarea').fill(
    'https://dribbble.com/shots/21031939\nhttps://dribbble.com/shots/20268452\nhttps://www.are.na/block/123',
  )
  await page.locator('[role="dialog"] .dsh-mb-switch').first().click()
  await page.evaluate(() => window.HARNESS.settle(120))
  const typedImport = await page.evaluate(() => {
    const dialog = document.querySelector('.dsh-mb-import-dialog')
    const count = dialog.querySelector('.dsh-mb-import-count')
    const pin = dialog.querySelector('.dsh-mb-switch')
    return {
      countText: (count.textContent || '').trim(),
      pinChecked: pin === null ? null : pin.getAttribute('aria-checked'),
      submitText: (dialog.querySelector('.dsh-mb-import-foot .dsh-mb-btn--primary').textContent || '').trim(),
    }
  })
  record('import typed: 3 / 20 counter, pin switch on', typedImport, (value) => value.countText === '3 / 20 links' && value.pinChecked === 'true')
  await shot(page, '15-import-links-typed.png')

  // -------------------------------------------------- import result summary
  await page.locator('[role="dialog"] .dsh-mb-import-foot .dsh-mb-btn--primary').click()
  await page.waitForSelector('[role="dialog"] .dsh-mb-import-summary')
  await page.evaluate(() => window.HARNESS.settle(150))
  const resultSummary = await page.evaluate(() => {
    const dialog = document.querySelector('.dsh-mb-import-dialog')
    const counts = dialog.querySelector('.dsh-mb-import-counts')
    const pills = Array.prototype.map.call(counts === null ? [] : counts.children, (node) => (node.textContent || '').trim())
    const failures = dialog.querySelector('.dsh-mb-import-failures')
    return { pills, failureLines: failures === null ? 0 : failures.children.length }
  })
  record(
    'import result: Added / Already on board / Failed pills',
    resultSummary,
    (value) => value.pills.some((text) => /^Added \d+/.test(text)) && value.pills.some((text) => /^Failed \d+/.test(text)) && value.failureLines > 0,
  )
  await shot(page, '16-import-result.png')

  // ------------------------------------------ focus ring, Esc, footer/scroll
  await goto(page)
  await page.locator('button[aria-label="Add from link"]').first().click()
  await page.waitForSelector('[role="dialog"].dsh-mb-import-dialog')
  for (let index = 0; index < 4; index += 1) await page.keyboard.press('Tab')
  const focusState = await page.evaluate(() => {
    const active = document.activeElement
    const rect = active.getBoundingClientRect()
    return {
      tag: active.tagName,
      label: active.getAttribute('aria-label'),
      text: (active.textContent || '').trim().slice(0, 40),
      focusVisible: active.matches(':focus-visible'),
      outline: getComputedStyle(active).outlineStyle,
      outlineWidth: getComputedStyle(active).outlineWidth,
      rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width) },
    }
  })
  record('keyboard focus ring visible in dialog', focusState, (value) => value.focusVisible === true && value.outlineWidth !== '0px')
  const dialogLayout = await dialogAudit(page)
  record(
    'import dialog: footer visible + body scrollable',
    dialogLayout,
    (value) => value !== null && value.footer.visible === true && ['auto', 'scroll'].indexOf(value.body.overflowY) !== -1,
  )
  await shot(page, '17-focus-ring.png')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[role="dialog"]', { state: 'detached' })
  const focusReturn = await page.evaluate(() => ({
    dialogClosed: document.querySelector('[role="dialog"]') === null,
    activeLabel: document.activeElement.getAttribute('aria-label'),
    inHeader: document.activeElement.closest('.dsh-mb-header') !== null,
  }))
  record('Esc closes dialog and returns focus to opener', focusReturn, (value) => value.dialogClosed === true && value.inHeader === true && value.activeLabel === 'Add from link')

  // ------------------------------------------------------- responsive 1024
  await setViewport(page, 1024, 768)
  await goto(page)
  const audit1024 = await layoutAudit(page)
  record('1024x768: no horizontal overflow / clipped controls', audit1024, (value) => value.documentOverflow === false && value.pageOverflow === false && value.clippedControls.length === 0)
  await shot(page, '18-page-1024-light.png')
  await page.locator('.dsh-mb-thumb-btn').first().click()
  await page.waitForSelector('.dsh-mb-details')
  await page.evaluate(() => window.HARNESS.settle(150))
  const sheet1024 = await page.evaluate(() => {
    const side = document.querySelector('.dsh-mb-side')
    const details = document.querySelector('.dsh-mb-details')
    const sideRect = side.getBoundingClientRect()
    const detailsRect = details.getBoundingClientRect()
    return {
      sidePosition: getComputedStyle(side).position,
      detailsTop: Math.round(detailsRect.top),
      detailsBottom: Math.round(detailsRect.bottom),
      viewportHeight: window.innerHeight,
      withinViewport: detailsRect.top >= 0 && detailsRect.bottom <= window.innerHeight + 1,
      footerVisible: (() => {
        const rect = details.querySelector('.dsh-mb-details-foot').getBoundingClientRect()
        return rect.top >= 0 && rect.bottom <= window.innerHeight + 1
      })(),
      left: Math.round(sideRect.left),
      right: Math.round(sideRect.right),
    }
  })
  record(
    '1024x768: inspector becomes an in-viewport bottom sheet with footer',
    sheet1024,
    (value) => value.sidePosition === 'fixed' && value.withinViewport === true && value.footerVisible === true,
  )
  await shot(page, '19-inspector-sheet-1024.png')

  // -------------------------------------------------------- responsive 768
  await setViewport(page, 768, 900)
  await goto(page)
  const audit768 = await layoutAudit(page)
  record('768x900: no horizontal overflow / clipped controls', audit768, (value) => value.documentOverflow === false && value.pageOverflow === false && value.clippedControls.length === 0)
  await shot(page, '20-page-768-light.png')
  await page.locator('.dsh-mb-thumb-btn').first().click()
  await page.waitForSelector('.dsh-mb-details')
  await page.evaluate(() => window.HARNESS.settle(150))
  const sheet768 = await page.evaluate(() => {
    const details = document.querySelector('.dsh-mb-details')
    const rect = details.getBoundingClientRect()
    return {
      sidePosition: getComputedStyle(document.querySelector('.dsh-mb-side')).position,
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      viewportHeight: window.innerHeight,
      withinViewport: rect.top >= 0 && rect.bottom <= window.innerHeight + 1,
      footerVisible: (() => {
        const foot = document.querySelector('.dsh-mb-details-foot').getBoundingClientRect()
        return foot.top >= 0 && foot.bottom <= window.innerHeight + 1
      })(),
    }
  })
  record(
    '768x900: inspector bottom sheet fits viewport with footer',
    sheet768,
    (value) => value.sidePosition === 'fixed' && value.withinViewport === true && value.footerVisible === true,
  )
  await shot(page, '21-inspector-sheet-768.png')

  await goto(page)
  await page.locator('button[aria-label="Add from link"]').first().click()
  await page.waitForSelector('[role="dialog"].dsh-mb-import-dialog')
  // Discover mode + a result summary is the tallest dialog content; use it to
  // prove the body scrolls internally while the footer stays reachable.
  await page.locator('[role="dialog"] .dsh-mb-import-mode').nth(1).click()
  await page.locator('[role="dialog"] #dsh-mb-import-query').fill('warm sand cards')
  await page.evaluate(() => window.HARNESS.settle(120))
  await page.locator('[role="dialog"] .dsh-mb-import-foot .dsh-mb-btn--primary').click()
  await page.waitForSelector('[role="dialog"] .dsh-mb-import-summary')
  await page.evaluate(() => window.HARNESS.settle(150))
  const import768 = await dialogAudit(page)
  record(
    '768x900: import dialog footer visible, body scrolls internally',
    import768,
    (value) => value !== null && value.footer.visible === true && value.body.overflowY === 'auto' && value.body.scrolls === true,
  )
  diagnostics.import768 = import768
  await page.evaluate(() => {
    const body = document.querySelector('[role="dialog"] .dsh-mb-merge-body')
    body.scrollTop = body.scrollHeight
  })
  await page.waitForTimeout(120)
  await shot(page, '22-import-768-result.png')

  // -------------------------------------------------------- responsive 390
  await setViewport(page, 390, 844)
  await goto(page)
  const audit390 = await layoutAudit(page)
  record('390x844: no horizontal overflow / clipped controls', audit390, (value) => value.documentOverflow === false && value.pageOverflow === false && value.clippedControls.length === 0)
  await shot(page, '23-page-390-light.png')
  await page.locator('button[aria-label="Add from link"]').first().click()
  await page.waitForSelector('[role="dialog"].dsh-mb-import-dialog')
  await page.evaluate(() => window.HARNESS.settle(120))
  const mobileImport = await dialogAudit(page)
  record(
    '390x844: import dialog is full-width, square, footer visible',
    mobileImport,
    (value) =>
      value !== null &&
      value.dialog.width === 390 &&
      value.dialog.borderRadius === '0px' &&
      value.footer.visible === true,
  )
  diagnostics.mobileImport = mobileImport
  if (mobileImport !== null && mobileImport.dialog.height < 844) {
    diagnostics.defects.push({
      id: 'mobile-import-not-full-height',
      screenshot: '24-mobile-import.png',
      selector: '@media (max-width: 640px) .dsh-mb-merge-dialog',
      detail: `import dialog is full-width but ${mobileImport.dialog.height}px tall at 390x844, centred rather than full-screen`,
      suggestedFix: 'add `height: 100%;` (or `height: 100dvh`) to the max-width:640 .dsh-mb-merge-dialog rule, or to .dsh-mb-import-dialog, so the full-screen import dialog fills the viewport',
    })
  }
  await shot(page, '24-mobile-import.png')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[role="dialog"]', { state: 'detached' })
  await page.locator('.dsh-mb-thumb-btn').first().click()
  await page.waitForSelector('.dsh-mb-details')
  await page.evaluate(() => window.HARNESS.settle(150))
  const mobileSheet = await page.evaluate(() => {
    const details = document.querySelector('.dsh-mb-details')
    const rect = details.getBoundingClientRect()
    return {
      sidePosition: getComputedStyle(document.querySelector('.dsh-mb-side')).position,
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      height: Math.round(rect.height),
      viewportHeight: window.innerHeight,
      withinViewport: rect.top >= 0 && rect.bottom <= window.innerHeight + 1,
      footerVisible: (() => {
        const foot = document.querySelector('.dsh-mb-details-foot').getBoundingClientRect()
        return foot.top >= 0 && foot.bottom <= window.innerHeight + 1
      })(),
    }
  })
  record(
    '390x844: inspector bottom sheet within viewport with footer',
    mobileSheet,
    (value) => value.sidePosition === 'fixed' && value.withinViewport === true && value.footerVisible === true,
  )
  await shot(page, '25-mobile-inspector-sheet.png')

  // ---------------------------------------- inspector manage group (bottom)
  await setViewport(page, 1280, 900)
  await goto(page)
  await page.locator('.dsh-mb-thumb-btn').first().click()
  await page.waitForSelector('.dsh-mb-details')
  await page.evaluate(() => {
    const body = document.querySelector('.dsh-mb-details-body')
    body.scrollTop = body.scrollHeight
  })
  await page.evaluate(() => window.HARNESS.settle(120))
  const manageState = await page.evaluate(() => {
    const manage = document.querySelector('.dsh-mb-details-manage')
    const remove = document.querySelector('.dsh-mb-details-actions .dsh-mb-btn--danger')
    const moveGroup = document.querySelector('.dsh-mb-move-group')
    const style = remove === null ? null : getComputedStyle(remove)
    return {
      hasManage: manage !== null,
      hasMoveGroup: moveGroup !== null,
      removeBorderColor: style === null ? null : style.borderColor,
      removeBackground: style === null ? null : style.backgroundColor,
      removeText: remove === null ? null : (remove.textContent || '').trim(),
      labels: Array.prototype.map.call(document.querySelectorAll('.dsh-mb-details-section-label'), (node) => (node.textContent || '').trim()),
    }
  })
  record(
    'inspector manage group: section labels, chevron pair, borderless Remove',
    manageState,
    (value) =>
      value.hasManage === true &&
      value.hasMoveGroup === true &&
      value.removeBorderColor === 'rgba(0, 0, 0, 0)' &&
      value.labels.indexOf('Manage') !== -1,
  )
  await shot(page, '26-inspector-manage.png')

  // -------------------------------------------------------- contrast audit
  await setViewport(page, 1280, 900)
  await goto(page)
  await page.locator('.dsh-mb-thumb-btn').first().click()
  await page.waitForSelector('.dsh-mb-details')
  await page.evaluate(() => window.HARNESS.settle(120))
  const lightInspector = await collectContrast(page, { theme: 'light' })
  await page.locator('button[aria-label="Add from link"]').first().click()
  await page.waitForSelector('[role="dialog"].dsh-mb-import-dialog')
  await page.evaluate(() => window.HARNESS.settle(120))
  const lightDialog = await collectContrast(page, { theme: 'light' })
  await page.keyboard.press('Escape')
  await page.waitForSelector('[role="dialog"]', { state: 'detached' })

  await goto(page, '?theme=dark')
  await page.locator('.dsh-mb-thumb-btn').first().click()
  await page.waitForSelector('.dsh-mb-details')
  await page.evaluate(() => window.HARNESS.settle(120))
  const darkInspector = await collectContrast(page, { theme: 'dark' })
  await page.locator('button[aria-label="Add from link"]').first().click()
  await page.waitForSelector('[role="dialog"].dsh-mb-import-dialog')
  await page.evaluate(() => window.HARNESS.settle(120))
  const darkDialog = await collectContrast(page, { theme: 'dark' })
  await page.keyboard.press('Escape')
  await page.waitForSelector('[role="dialog"]', { state: 'detached' })

  function buildContrast(theme, base, dialog) {
    const rows = [
      ['Primary CTA text on coral-600 fill', base.primary && base.primary.color, base.primary && base.primary.background, 4.5, 'body text 12.5px/600'],
      ['Active filter chip text on coral-600 fill', base.chip && base.chip.color, base.chip && base.chip.background, 4.5, 'body text 12px/600'],
      ['Style-guide pill text on coral-600 fill', base.pill && base.pill.color, base.pill && base.pill.background, 4.5, 'label 10.5px/650'],
      ['accent-ink mix on card', base.accentInk, base.cardBg, 4.5, 'label text (kicker/active tab)'],
      ['Inspector kicker on elevated card', base.kicker && base.kicker.color, base.kicker && base.kicker.background, 4.5, 'kicker 10px/650'],
      ['Section label on elevated card', base.sectionLabel && base.sectionLabel.color, base.sectionLabel && base.sectionLabel.background, 4.5, 'label 10px/650'],
      ['Secondary hint on canvas', base.hint && base.hint.color, base.hint && base.hint.background, 4.5, 'hint 12px/400'],
      ['Import footer hint on footer surface', dialog.importStatus && dialog.importStatus.color, dialog.importStatus && dialog.importStatus.background, 4.5, 'footer hint 12px/400'],
    ]
    return rows.map(([id, fg, bg, threshold, note]) => {
      const ratio = contrastRatio(fg, bg)
      return { id, theme, fg: parseRgb(fg), bg: parseRgb(bg), ratio, threshold, note, pass: ratio !== null && ratio >= threshold }
    })
  }
  const contrast = [...buildContrast('light', lightInspector, lightDialog), ...buildContrast('dark', darkInspector, darkDialog)]
  const contrastFailures = contrast.filter((row) => !row.pass)
  console.log('[capture] contrast ratios:')
  for (const row of contrast) {
    console.log(`  ${row.pass ? 'PASS' : 'FAIL'} ${row.theme.padEnd(5)} ${String(row.ratio).padStart(5)}:1  ${row.id}`)
  }
  diagnostics.contrast = contrast
  diagnostics.contrastFailures = contrastFailures.length
} finally {
  const report = {
    generatedAt: new Date().toISOString(),
    url: `${baseUrl}${PAGE}`,
    viewports: Array.from(new Set(shots.map((entry) => `${entry.width}x${entry.height}`))),
    client: await page.evaluate(() => (window.HARNESS ? window.HARNESS.clientUrl : null)).catch(() => null),
    shots,
    checks,
    pageErrors,
    consoleMessages,
    contrast: diagnostics.contrast,
    contrastFailures: diagnostics.contrastFailures,
    defects: diagnostics.defects,
    dialogLayouts: { import768: diagnostics.import768, mobileImport: diagnostics.mobileImport },
  }
  await writeFile(resolve(SHOTS, 'console.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await browser.close()
  serving.server.close()
  console.log(
    `[capture] ${checks.length} checks passed, ${pageErrors} page/console error(s), ${diagnostics.contrastFailures} contrast pair(s) under threshold`,
  )
  if (pageErrors > 0) {
    for (const entry of consoleMessages.filter((message) => message.type === 'error' || message.type === 'pageerror')) {
      console.error(`  - [${entry.type}] ${entry.text}`)
    }
    process.exitCode = 1
  }
}
