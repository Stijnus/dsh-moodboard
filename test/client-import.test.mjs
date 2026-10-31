/**
 * Static + load checks for the 0.3.0 client intake UI (client.js).
 *
 * These tests are deliberately source-level: the client half is a browser
 * module with no build step, so the contract it must satisfy is which ids,
 * routes, attributes and locale keys it references. The load test proves the
 * module still evaluates under the DSH module loader with React only.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const root = new URL('../', import.meta.url)
const read = (name) => readFile(new URL(name, root), 'utf8')

/** Keys declared directly on one locale dictionary object (8-space indent). */
function dictionaryKeys(source, locale) {
  const start = source.indexOf(`      ${locale}: {`)
  assert.ok(start !== -1, `dictionary ${locale} must exist`)
  const end = locale === 'en' ? source.indexOf('      zh: {', start) : source.indexOf('\n      },\n    }', start)
  assert.ok(end !== -1, `dictionary ${locale} must be terminated`)
  const keys = []
  for (const line of source.slice(start, end).split('\n')) {
    const match = /^ {8}([A-Za-z0-9_]+):/.exec(line)
    if (match) keys.push(match[1])
  }
  return keys
}

const IMPORT_KEYS = [
  'addFromLink',
  'importTitle',
  'importClose',
  'importModeLabel',
  'importTabLink',
  'importTabDiscover',
  'importLinkLabel',
  'importLinkPlaceholder',
  'importLinkHint',
  'importSourcesLabel',
  'importSourcesLoading',
  'importSourcesFailed',
  'importNoSources',
  'importMobbinUnavailable',
  'importDiscoverQuery',
  'importDiscoverQueryPlaceholder',
  'importDiscoverPlatform',
  'importPlatformIos',
  'importPlatformWeb',
  'importDiscoverLimit',
  'importDiscoverHint',
  'importPin',
  'importSubmitLinks',
  'importSubmitDiscover',
  'importSubmitting',
  'importNeedLinks',
  'importTooManyLinks',
  'importNeedQuery',
  'importQueryTooLong',
  'importLimitInvalid',
  'importFailed',
  'importResultsTitle',
  'importAddedCount',
  'importDuplicateCount',
  'importFailedCount',
  'importNoFailures',
  'importMoreFailures',
  'importFailure',
  'importUnknownFailure',
  'importCopyWorkflow',
  'importCopyingWorkflow',
  'importWorkflowCopied',
  'importWorkflowUnavailable',
  'importWorkflowCopyFailed',
  'importDone',
]

test('client loads under the module loader with React only', async () => {
  const source = await read('client.js')
  let plugin = null
  const React = {
    createElement: () => null,
    useState: () => [],
    useEffect: () => {},
    useRef: () => ({ current: null }),
    useSyncExternalStore: () => null,
  }
  assert.doesNotThrow(() => {
    runInNewContext(source, {
      window: {
        __ModuleLoader__: {
          load: ({ id, factory }) => {
            assert.equal(id, 'dsh-moodboard')
            plugin = factory(() => React)
          },
        },
      },
      URL,
    })
  })
  assert.ok(plugin, 'factory must be invoked')
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale'])
  assert.equal(typeof plugin.apply, 'function')
})

test('0.3.0 client keeps the browser-module constraints and intake routes', async () => {
  const source = await read('client.js')
  assert.doesNotMatch(source, /^\s*import\s/m, 'no ESM imports in the browser half')
  const requires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1])
  for (const name of requires) {
    assert.ok(name === 'react' || name === 'react/jsx-runtime', `unexpected client require: ${name}`)
  }
  for (const anchor of [
    '/moodboard/api/import',
    '/moodboard/api/sources',
    'IMPORT_PATH',
    'SOURCES_PATH',
    'JSON.stringify(body)',
  ]) {
    assert.ok(source.includes(anchor), `client source must reference ${anchor}`)
  }
})

test('import dialog is a labelled modal with a focus trap and Esc', async () => {
  const source = await read('client.js')
  for (const anchor of [
    'function ImportDialog',
    "role: 'dialog'",
    "'aria-modal': 'true'",
    "'aria-labelledby': headingId",
    'dsh-mb-import-dialog',
    'LIGHTBOX_FOCUSABLE',
    "event.key !== 'Tab'",
    "event.key === 'Escape'",
    'openerRef',
    'document.activeElement',
  ]) {
    assert.ok(source.includes(anchor), `import dialog must reference ${anchor}`)
  }
  // Both entry points (header action and empty state) open the dialog.
  const openers = source.match(/setImportOpen\(true\)/g) || []
  assert.ok(openers.length >= 2, 'header and empty state must open the import dialog')
  assert.match(source, /aria-haspopup': 'dialog'/, 'header action announces the dialog')
  assert.doesNotMatch(source, /window\.confirm/, 'no window.confirm anywhere in the client')
})

test('link mode posts urls/tags/pinned and honours the 1..20 limit', async () => {
  const source = await read('client.js')
  for (const anchor of [
    'parseImportUrls',
    'MAX_IMPORT_URLS = 20',
    'importNeedLinks',
    'importTooManyLinks',
    'method: \'POST\'',
    "'content-type': 'application/json'",
    'urls,',
    'tags,',
    'pinned }',
  ]) {
    assert.ok(source.includes(anchor), `link intake must reference ${anchor}`)
  }
  assert.match(source, /\{ urls, tags, pinned \}/, 'link body matches the Host contract')
})

test('discover mode reads /api/sources and posts source/query/platform/limit', async () => {
  const source = await read('client.js')
  for (const anchor of [
    'importSourcesLoading',
    'importNoSources',
    'importMobbinUnavailable',
    'MOBBIN_API_KEY',
    'configPath',
    'importDiscoverQuery',
    'importDiscoverPlatform',
    'importPlatformIos',
    'importPlatformWeb',
    'importDiscoverLimit',
    'MAX_DISCOVER_LIMIT = 12',
    'importLimitInvalid',
    'source: activeSource.id',
    'query: trimmedQuery',
    'platform,',
    'limit: parsedLimit',
  ]) {
    assert.ok(source.includes(anchor), `discover intake must reference ${anchor}`)
  }
  assert.match(
    source,
    /body = \{ source: activeSource\.id, query: trimmedQuery, platform, limit: parsedLimit, tags, pinned \}/,
    'discover body matches the Host contract',
  )
})

test('import results summarise added/duplicate/failed and copy the workflow', async () => {
  const source = await read('client.js')
  for (const anchor of [
    'payload.imported',
    'payload.duplicates',
    'payload.failures',
    'importAddedCount',
    'importDuplicateCount',
    'importFailedCount',
    'importMoreFailures',
    'importFailure',
    'importResultsTitle',
    'copyText(workflow)',
    'importCopyWorkflow',
    'importWorkflowCopied',
    'importWorkflowUnavailable',
    'importDone',
    // The board behind the dialog refreshes without its skeleton afterwards.
    'refresh({ silent: true })',
    // Route-level failures still reach the shared page banner.
    "setState({ error: message })",
  ]) {
    assert.ok(source.includes(anchor), `result UI must reference ${anchor}`)
  }
  assert.ok(source.includes('workflow'), 'workflow text must come from the sources response')
})

test('host responses are normalised defensively before rendering', async () => {
  const source = await read('client.js')
  for (const anchor of [
    'Array.isArray(payload.imported)',
    'Array.isArray(payload.duplicates)',
    'Array.isArray(payload.failures)',
    'Array.isArray(payload.sources)',
    "typeof payload.workflow === 'string'",
    "typeof payload.configPath === 'string'",
    "row.kind === 'search'",
    'row.available === true',
  ]) {
    assert.ok(source.includes(anchor), `response handling must reference ${anchor}`)
  }
})

test('client never fetches inspiration sources directly', async () => {
  const source = await read('client.js')
  for (const anchor of ['api.mobbin.com', 'api.are.na', 'mobbin.com/v1', 'are.na/v2']) {
    assert.ok(!source.includes(anchor), `client must not call the source API directly: ${anchor}`)
  }
})

test('en and zh dictionaries keep key parity and cover every import string', async () => {
  const source = await read('client.js')
  const en = dictionaryKeys(source, 'en')
  const zh = dictionaryKeys(source, 'zh')
  assert.equal(new Set(en).size, en.length, 'en dictionary has no duplicate keys')
  assert.equal(new Set(zh).size, zh.length, 'zh dictionary has no duplicate keys')
  assert.deepEqual([...en].sort(), [...zh].sort(), 'en and zh dictionaries stay in parity')

  const missingEn = IMPORT_KEYS.filter((key) => !en.includes(key))
  const missingZh = IMPORT_KEYS.filter((key) => !zh.includes(key))
  assert.deepEqual(missingEn, [], `en dictionary is missing import keys: ${missingEn.join(', ')}`)
  assert.deepEqual(missingZh, [], `zh dictionary is missing import keys: ${missingZh.join(', ')}`)

  // Empty translations are a parity bug hiding behind a matching key list.
  for (const key of IMPORT_KEYS) {
    assert.match(source, new RegExp(`^ {8}${key}: '[^']+'`, 'm'), `${key} must have a non-empty en value`)
    assert.match(source, new RegExp(`^ {8}${key}: '[^']*[^']'`, 'm'), `${key} must have a non-empty zh value`)
  }
})

/**
 * Minimal manual hooks harness, mirroring the existing MetadataPanel test:
 * enough of React to render one component pass, run effects and read the tree.
 */
async function loadImportDialog(fetch) {
  const hooks = []
  const effects = []
  let cursor = 0
  const React = {
    createElement(type, props, ...children) {
      return { type, props: { ...(props || {}), children } }
    },
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [
        hooks[index],
        (next) => {
          hooks[index] = typeof next === 'function' ? next(hooks[index]) : next
        },
      ]
    },
    useEffect(callback, deps) {
      const index = cursor++
      if (hooks[index] && deps.every((value, offset) => Object.is(value, hooks[index][offset]))) return
      hooks[index] = deps
      effects.push(callback)
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { current: initial === undefined ? null : initial }
      return hooks[index]
    },
    useSyncExternalStore() {
      return null
    },
  }
  let plugin
  const source = (await read('client.js')).replace(
    "inject: ['slots', 'locale'],",
    "inject: ['slots', 'locale'], ImportDialog,",
  )
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => React) } } },
    document: { addEventListener() {}, removeEventListener() {} },
    fetch,
    URL,
  })
  return {
    plugin,
    render(props) {
      cursor = 0
      const tree = plugin.ImportDialog(props)
      while (effects.length > 0) effects.shift()()
      return tree
    },
  }
}

function flattenText(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join(' ')
  if (typeof node === 'object') return flattenText(node.props && node.props.children)
  return ''
}

function findNode(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findNode(child, predicate)
      if (match !== undefined) return match
    }
    return undefined
  }
  if (predicate(node)) return node
  return findNode(node.props && node.props.children, predicate)
}

async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

test('import dialog renders both modes and posts the contract body', async () => {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/sources')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          sources: [
            { id: 'web', kind: 'capture', label: 'Any link', available: true, detail: 'capture' },
            { id: 'mobbin', kind: 'search', label: 'Mobbin', available: true, detail: 'connected', platforms: ['ios', 'web'] },
            { id: 'arena', kind: 'search', label: 'Are.na', available: true, detail: 'public' },
            { id: 'dribbble', kind: 'browser', label: 'Dribbble', available: false, detail: 'blocked' },
          ],
          workflow: 'INSPIRATION WORKFLOW',
          configPath: '/data/sources.json',
        }),
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        imported: [{ id: 'mb_0123456789ab', name: 'shot' }],
        duplicates: [{ id: 'mb_0123456789ac', name: 'old' }],
        failures: [{ input: 'https://example.test/a', code: 'no-preview-image', message: 'No preview image' }],
      }),
    }
  }
  const dialog = await loadImportDialog(fetch)
  let closed = 0
  const props = {
    t: (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`),
    onClose: () => {
      closed += 1
    },
    openerRef: { current: null },
  }

  // First paint: Link mode, labelled modal, focus trap attributes, 1..20 links.
  let tree = dialog.render(props)
  await flushAsync()
  tree = dialog.render(props)
  assert.match(flattenText(tree), /importTitle/)
  assert.ok(findNode(tree, (node) => node.props && node.props.role === 'dialog'), 'dialog role')
  assert.equal(findNode(tree, (node) => node.props && node.props['aria-modal'] === 'true') !== undefined, true)
  assert.ok(findNode(tree, (node) => node.type === 'textarea' && node.props.id === 'dsh-mb-import-links'))
  assert.ok(flattenText(tree).includes('importTabLink') && flattenText(tree).includes('importTabDiscover'))

  // Switch to Discover: source select only lists available search sources,
  // Mobbin contributes its platform select and the limit defaults to 6.
  const modeButtons = []
  const collect = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(collect)
      return
    }
    if (node.props && node.props.className === 'dsh-mb-import-mode') modeButtons.push(node)
    collect(node.props && node.props.children)
  }
  collect(tree)
  assert.equal(modeButtons.length, 2, 'two import modes')
  modeButtons[1].props.onClick()
  tree = dialog.render(props)
  const sourceSelect = findNode(tree, (node) => node.type === 'select' && node.props.id === 'dsh-mb-import-source')
  assert.ok(sourceSelect, 'source select appears once sources load')
  const optionValues = []
  const collectOptions = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(collectOptions)
      return
    }
    if (node.type === 'option') optionValues.push(node.props.value)
    collectOptions(node.props && node.props.children)
  }
  collectOptions(sourceSelect)
  assert.deepEqual(optionValues, ['mobbin', 'arena'], 'only available search sources are offered')
  assert.ok(findNode(tree, (node) => node.type === 'select' && node.props.id === 'dsh-mb-import-platform'))
  assert.equal(findNode(tree, (node) => node.type === 'input' && node.props.id === 'dsh-mb-import-limit').props.value, '6')

  // Type a query and submit: the POST body matches the Host contract.
  findNode(tree, (node) => node.type === 'input' && node.props.id === 'dsh-mb-import-query').props.onChange({
    currentTarget: { value: 'checkout paywall' },
  })
  tree = dialog.render(props)
  const submit = findNode(
    tree,
    (node) => node.type === 'button' && node.props.className === 'dsh-mb-btn dsh-mb-btn--primary',
  )
  assert.ok(submit, 'discover submit button')
  submit.props.onClick()
  await flushAsync()
  const post = calls.find((call) => call.init && call.init.method === 'POST')
  assert.ok(post, 'import POST was made')
  assert.equal(post.url, '/moodboard/api/import')
  assert.deepEqual(JSON.parse(post.init.body), {
    source: 'mobbin',
    query: 'checkout paywall',
    platform: 'ios',
    limit: 6,
    tags: [],
    pinned: false,
  })

  // Result summary counts, failure line and workflow copy sit in the dialog.
  tree = dialog.render(props)
  const text = flattenText(tree)
  assert.match(text, /importResultsTitle/)
  assert.match(text, /importAddedCount/)
  assert.match(text, /importDuplicateCount/)
  assert.match(text, /importFailedCount/)
  assert.match(text, /No preview image/)
  assert.match(text, /importCopyWorkflow/)
  // Importing a reference refreshed the board silently behind the dialog.
  assert.ok(calls.some((call) => call.url.endsWith('/api/state')), 'silent board refresh after import')
  assert.equal(closed, 0, 'the dialog never closes on its own after an import')

  // Back to Link mode: an empty submit is blocked client-side, then a pasted
  // list is de-duplicated and posted as { urls, tags, pinned }.
  const postsBefore = calls.filter((call) => call.init && call.init.method === 'POST').length
  modeButtons[0].props.onClick()
  tree = dialog.render(props)
  findNode(tree, (node) => node.type === 'button' && node.props.className === 'dsh-mb-btn dsh-mb-btn--primary').props.onClick()
  tree = dialog.render(props)
  assert.match(flattenText(tree), /importNeedLinks/, 'empty link submit is rejected before the request')
  assert.equal(calls.filter((call) => call.init && call.init.method === 'POST').length, postsBefore)

  findNode(tree, (node) => node.type === 'textarea' && node.props.id === 'dsh-mb-import-links').props.onChange({
    currentTarget: { value: 'https://a.test/one\nhttps://a.test/two https://a.test/one' },
  })
  tree = dialog.render(props)
  findNode(tree, (node) => node.type === 'button' && node.props.className === 'dsh-mb-btn dsh-mb-btn--primary').props.onClick()
  await flushAsync()
  const linkPost = calls.filter((call) => call.init && call.init.method === 'POST').pop()
  assert.deepEqual(JSON.parse(linkPost.init.body), {
    urls: ['https://a.test/one', 'https://a.test/two'],
    tags: [],
    pinned: false,
  })
})
