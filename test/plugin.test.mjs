import assert from 'node:assert/strict'
import { copyFile, readFile, mkdtemp, mkdir, rm, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { apply } from '../index.js'
import { setDefaultFetch } from '../sources.js'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'

const root = new URL('../', import.meta.url)
const read = (name) => readFile(new URL(name, root), 'utf8')

test('manifest declares the bundle, client half and runtime files', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.equal(pkg.name, 'dsh-moodboard')
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  assert.equal(pkg.private, undefined)
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'))
  assert.match(pkg.engines.dsh, /0\.2\.1-rc\.3/)
  for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md']) {
    assert.ok(pkg.files.includes(file), `files must include ${file}`)
  }
  assert.ok(pkg.files.includes('locale/*.json'))
})

test('loader patch inserts the moodboard row for this package', async () => {
  const patch = await read('cordis.patch.yml')
  assert.match(patch, /id: moodboard/)
  assert.match(patch, /name: 'dsh-moodboard'/)
})

test('host half exports name, inject and apply', async () => {
  const host = await import(new URL('index.js', root))
  assert.equal(host.name, 'moodboard')
  for (const service of ['attachments', 'tools', 'systemPrompt', 'webServer', 'connection']) {
    assert.ok(host.inject.includes(service), `inject must include ${service}`)
  }
  assert.equal(typeof host.apply, 'function')
})

test('host half imports only node builtins and registers its surfaces', async () => {
  const source = await read('index.js')
  const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
  for (const specifier of specifiers) {
    assert.ok(
      specifier.startsWith('node:') || specifier === './sources.js',
      `unexpected host import: ${specifier}`,
    )
  }
  for (const anchor of [
    'ctx.webServer.register',
    'ctx.tools.register',
    'ctx.systemPrompt.section',
    'saveImage',
    'readImage',
    '/moodboard',
  ]) {
    assert.ok(source.includes(anchor), `host source must reference ${anchor}`)
  }
})

test('client half loads under the package id with allowed requires only', async () => {
  const source = await read('client.js')
  const loader = source.match(/__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/)
  assert.ok(loader, 'client must call window.__ModuleLoader__.load with an id')
  assert.equal(loader[1], 'dsh-moodboard')
  assert.doesNotMatch(source, /^\s*import\s/m)
  const requires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1])
  for (const name of requires) assert.ok(name === 'react' || name === 'react/jsx-runtime', `unexpected client require: ${name}`)
  for (const anchor of [
    "name: 'sidebar.panellist'",
    "id: 'moodboard'",
    "name: 'main'",
    "key: 'moodboard'",
    "name: 'conversation.input.right'",
  ]) {
    assert.ok(source.includes(anchor), `client source must reference ${anchor}`)
  }
})

test('locale resources carry plugin metadata and stay in parity', async () => {
  const en = JSON.parse(await read('locale/en.json'))
  const zh = JSON.parse(await read('locale/zh.json'))
  assert.ok(en.meta.title.length > 0)
  assert.ok(en.meta.description.length > 0)
  assert.ok(zh.meta.title.length > 0)
  assert.ok(zh.meta.description.length > 0)
})

test('agent tool and prompt section are documented in the host', async () => {
  const source = await read('index.js')
  assert.match(source, /name: 'moodboard'/)
  assert.match(source, /moodboard:style-guide/)
  assert.match(source, /type: 'image'/)
})

test('0.2 reorder/bulk endpoints and client interactions are wired', async () => {
  const host = await read('index.js')
  for (const anchor of [
    '/api/images/reorder',
    '/api/images/bulk',
    'handleReorderImages',
    'handleBulkImages',
    'requireIdList',
  ]) {
    assert.ok(host.includes(anchor), `host source must reference ${anchor}`)
  }
  const client = await read('client.js')
  for (const anchor of [
    '/moodboard/api/images/reorder',
    '/moodboard/api/images/bulk',
    'application/x-moodboard-id',
    'clipboardData',
  ]) {
    assert.ok(client.includes(anchor), `client source must reference ${anchor}`)
  }
})

test('0.2.1 search and lightbox are wired', async () => {
  const client = await read('client.js')
  for (const anchor of [
    'searchQuery',
    'matchesSearch',
    'searchPlaceholder',
    'lightboxId',
    'lightboxOpenLabel',
    "role: 'dialog'",
    'aria-modal',
    'dsh-mb-lightbox',
  ]) {
    assert.ok(client.includes(anchor), `client source must reference ${anchor}`)
  }
})

test('0.2.2 tag merge endpoint is wired', async () => {
  const host = await read('index.js')
  for (const anchor of ['/api/tags/merge', 'handleMergeTags', 'requireMergeTag']) {
    assert.ok(host.includes(anchor), `host source must reference ${anchor}`)
  }
})

test('0.2.2 tag autocomplete and metadata clipboard are wired', async () => {
  const client = await read('client.js')
  for (const anchor of [
    'dsh-mb-tag-suggestions',
    'metadataClipboard',
    '/moodboard/api/tags/merge',
    'TagMergeDialog',
  ]) {
    assert.ok(client.includes(anchor), `client source must reference ${anchor}`)
  }
})

test('0.2.3 select-all and invert selection are wired', async () => {
  const client = await read('client.js')
  for (const anchor of [
    'selectAllImages',
    'invertSelectedImages',
    'bulkInvertLabel',
    'metaKey',
    'visibleIdsRef',
  ]) {
    assert.ok(client.includes(anchor), `client source must reference ${anchor}`)
  }
})

test('0.2.3 lazy thumbnails and progressive gallery are wired', async () => {
  const client = await read('client.js')
  for (const anchor of [
    'useInView',
    'IntersectionObserver',
    'GALLERY_PAGE_SIZE',
    'function LoadMore',
    'renderLimit',
    'dsh-mb-thumb-frame',
  ]) {
    assert.ok(client.includes(anchor), `client source must reference ${anchor}`)
  }
})

test('0.2.3 keyboard reorder and shortcut help are wired', async () => {
  const client = await read('client.js')
  for (const anchor of [
    'ShortcutsDialog',
    'shortcutReorder',
    'pendingCardFocusId',
    'aria-keyshortcuts',
    'moveCardByOffset',
  ]) {
    assert.ok(client.includes(anchor), `client source must reference ${anchor}`)
  }
})

test('0.2.3 drag end zone and move fallback are wired', async () => {
  const client = await read('client.js')
  for (const anchor of [
    'onEndDrop',
    'reorderCancelled',
    'moveLeftLabel',
    'moveCardByOffset',
    'dsh-mb-drop-end',
  ]) {
    assert.ok(client.includes(anchor), `client source must reference ${anchor}`)
  }
})

async function withBoard(run, prepare = async () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-moodboard-test-'))
  const oldHome = process.env.DSH_HOME
  try {
    await prepare(root)
    process.env.DSH_HOME = root
    let handler, tool
    const imageBytes = new Map()
    const sections = []
    // Tests may set `hooks.beforeSave` to hold an attachment save open.
    const hooks = { beforeSave: null }
    apply({
      effect: (fn) => fn(),
      webServer: { register: (route) => { handler = route.handler; return () => {} } },
      tools: { register: (value) => { tool = value; return () => {} } },
      systemPrompt: { section: (value) => { sections.push(value); return () => {} } },
      connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
      logger: { warn() {} },
      attachments: {
        saveImage: async ({ data, mediaType, name }) => {
          if (typeof hooks.beforeSave === 'function') await hooks.beforeSave({ data, mediaType, name })
          const attachmentId = createHash('sha256').update(data).digest('hex')
          imageBytes.set(attachmentId, data)
          return { attachmentId, bytes: data.length, mediaType, name, width: 1, height: 1 }
        },
        readImage: async (ref) => ({ ref, data: imageBytes.get(ref.attachmentId) }),
      },
    })
    const request = (method, path, body) => new Promise((resolve) => {
      const req = new EventEmitter()
      req.method = method; req.url = '/moodboard' + path
      req.headers = { 'content-type': 'application/json' }
      req.resume = () => {}
      let status, headers
      handler(req, {
        writeHead: (value, fields) => { status = value; headers = fields },
        end: (value) => resolve({ status, headers, body: headers['content-type'].startsWith('application/json') ? JSON.parse(value) : value }),
      })
      setImmediate(() => { if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end') })
    })
    await run({ request, tool, root, sections, imageBytes, hooks })
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    await rm(root, { recursive: true, force: true })
  }
}
const upload = { data: 'aW1hZ2U=', mediaType: 'image/png', name: 'reference.png', tags: ['warm'], notes: 'Use soft spacing' }

test('images, tags, notes and pins persist and reach model image blocks', async () => {
  await withBoard(async ({ request, tool, root }) => {
    const created = await request('POST', '/api/images', upload)
    assert.equal(created.status, 200)
    const id = created.body.image.id
    const pinned = await request('PATCH', '/api/images/' + id, { pinned: true, tags: ['quiet'], notes: 'Preserve spacing' })
    assert.equal(pinned.status, 200)
    const board = JSON.parse(await readFile(join(root, 'moodboard/board.json'), 'utf8'))
    assert.equal(board.images[0].pinned, true)
    assert.deepEqual(board.images[0].tags, ['quiet'])
    const value = await tool.execute({ action: 'active' })
    assert.equal(value.ok, true)
    assert.match(value.brief, /Preserve spacing/)
    assert.equal(tool.output.render({ action: 'active' }, value)[1].type, 'image')
  })
})

test('a failed initial read blocks writes instead of replacing existing data', async () => {
  await withBoard(async ({ request, root }) => {
    assert.equal((await request('GET', '/api/state')).status, 500)
    await rename(join(root, 'moodboard/board.json'), join(root, 'moodboard/original-unreadable'))
    const result = await request('POST', '/api/images', upload)
    assert.equal(result.status, 500)
    await assert.rejects(readFile(join(root, 'moodboard/board.json')), { code: 'ENOENT' })
  }, async (root) => mkdir(join(root, 'moodboard/board.json'), { recursive: true }))
})


test('image URLs change only with content and old revisions cannot serve new bytes', async () => {
  await withBoard(async ({ request }) => {
    const created = (await request('POST', '/api/images', upload)).body.image
    const path = created.imageUrl.replace('/moodboard', '')
    const original = await request('GET', path)
    assert.equal(original.status, 200)
    assert.match(original.headers['cache-control'], /immutable/)
    assert.equal(Buffer.from(original.body).toString(), 'image')
    const patched = await request('PATCH', '/api/images/' + created.id, { notes: 'changed', pinned: true })
    assert.equal(patched.body.image.imageUrl, created.imageUrl)
    await request('POST', '/api/images/reorder', { ids: [created.id] })
    const state = await request('GET', '/api/state')
    assert.equal(state.body.board.images[0].imageUrl, created.imageUrl)
    const replaced = await request('POST', '/api/images/' + created.id + '/replace', { ...upload, data: Buffer.from('replacement').toString('base64') })
    assert.notEqual(replaced.body.image.imageUrl, created.imageUrl)
    assert.equal((await request('GET', path)).status, 404)
    const current = await request('GET', replaced.body.image.imageUrl.replace('/moodboard', ''))
    assert.equal(Buffer.from(current.body).toString(), 'replacement')
    const unversioned = await request('GET', '/image/' + created.id)
    assert.equal(unversioned.headers['cache-control'], 'no-store')
  })
})

test('get renders complete metadata even without image blocks, and overviews expose ids', async () => {
  await withBoard(async ({ request, tool }) => {
    const notes = 'A'.repeat(3900) + '\nREQUIRED_DESIGN_RULE'
    const sourceUrl = 'https://example.com/reference'
    const image = (await request('POST', '/api/images', { ...upload, notes, sourceUrl })).body.image
    for (const action of ['active', 'query']) {
      const value = await tool.execute({ action })
      const text = tool.output.render({ action }, value)[0].text
      assert.ok(text.includes(image.id))
      assert.match(text, /complete notes/)
    }
    for (const includeImages of [true, false]) {
      const args = { action: 'get', id: image.id, includeImages }
      const blocks = tool.output.render(args, await tool.execute(args))
      assert.ok(blocks[0].text.includes(notes))
      assert.ok(blocks[0].text.includes(sourceUrl))
      assert.equal(blocks.filter((block) => block.type === 'image').length, includeImages ? 1 : 0)
    }
  })
})

async function clientCache(fetch) {
  let plugin
  const revoked = []
  let serial = 0
  const source = (await read('client.js')).replace("inject: ['slots', 'locale'],", "inject: ['slots', 'locale'], imageKey, loadImageUrl, applyBoard, disposeImageUrls, imageUrlCache,")
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => ({})) } } },
    URL: { createObjectURL: () => 'blob:' + ++serial, revokeObjectURL: (url) => revoked.push(url) },
    fetch,
  })
  return { plugin, revoked }
}

test('client cache reuses metadata revisions and releases replaced and deleted images', async () => {
  let fetches = 0
  const { plugin, revoked } = await clientCache(async () => {
    fetches += 1
    return { ok: true, blob: async () => ({}) }
  })
  const image = { id: 'mb_0123456789ab', imageUrl: '/moodboard/image/id?v=first' }
  plugin.applyBoard({ images: [image] })
  const key = plugin.imageKey(image)
  const first = await plugin.loadImageUrl(key, image.imageUrl)
  const edited = { ...image, updatedAt: 'new', notes: 'new', pinned: true, order: 2 }
  plugin.applyBoard({ images: [edited] })
  assert.equal(plugin.imageKey(edited), key)
  assert.equal(await plugin.loadImageUrl(plugin.imageKey(edited), edited.imageUrl), first)
  assert.equal(fetches, 1)
  const replacement = { ...edited, imageUrl: '/moodboard/image/id?v=second' }
  plugin.applyBoard({ images: [replacement] })
  assert.deepEqual(revoked, [first])
  assert.equal(plugin.imageUrlCache.size, 0)
  const second = await plugin.loadImageUrl(plugin.imageKey(replacement), replacement.imageUrl)
  plugin.applyBoard({ images: [] })
  assert.deepEqual(revoked, [first, second])
  assert.equal(plugin.imageUrlCache.size, 0)
})

test('in-flight image loads cannot repopulate the cache after replacement, removal or disposal', async () => {
  for (const action of ['replace', 'remove', 'dispose']) {
    let finish
    const { plugin, revoked } = await clientCache(() => new Promise((resolve) => { finish = resolve }))
    const image = { id: 'mb_0123456789ab', imageUrl: '/moodboard/image/id?v=first' }
    plugin.applyBoard({ images: [image] })
    const pending = plugin.loadImageUrl(plugin.imageKey(image), image.imageUrl)
    const rejected = assert.rejects(pending, /disposed/)
    if (action === 'dispose') plugin.disposeImageUrls()
    else plugin.applyBoard({ images: action === 'replace' ? [{ ...image, imageUrl: image.imageUrl + 'new' }] : [] })
    finish({ ok: true, blob: async () => ({}) })
    await rejected
    assert.equal(plugin.imageUrlCache.size, 0)
    assert.equal(revoked.length, 1)
  }
})

test('metadata editor follows server revisions while preserving actual unsaved edits', async () => {
  let plugin, cursor = 0
  const hooks = [], effects = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useRef(value) {
      const index = cursor++
      return hooks[index] ??= { current: value }
    },
    useState(value) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof value === 'function' ? value() : value
      return [hooks[index], (next) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next }]
    },
    useEffect(callback, deps) {
      const index = cursor++
      if (hooks[index] && deps.every((value, offset) => Object.is(value, hooks[index][offset]))) return
      hooks[index] = deps
      effects.push(callback)
    },
  }
  const source = (await read('client.js')).replace("inject: ['slots', 'locale'],", "inject: ['slots', 'locale'], MetadataPanel,")
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => React) } } },
  })
  function render(image) {
    cursor = 0
    const tree = plugin.MetadataPanel({ image, t: (key) => key, allTags: [] })
    while (effects.length) effects.shift()()
    return tree
  }
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return undefined
    if (predicate(node)) return node
    for (const child of (node.children || []).flat(Infinity)) {
      const match = find(child, predicate)
      if (match) return match
    }
  }
  const image = { id: 'mb_0123456789ab', name: 'old.png', tags: [], notes: '', sourceUrl: '', pinned: false, updatedAt: '1' }
  render(image)
  const replacement = { ...image, name: 'replacement.png', updatedAt: '2' }
  render(replacement)
  let tree = render(replacement)
  const nameInput = (node) => node.type === 'input' && node.props.id.endsWith('-name')
  assert.equal(find(tree, nameInput).props.value, 'replacement.png')
  find(tree, nameInput).props.onChange({ currentTarget: { value: 'my unsaved name' } })
  render(replacement)
  const externalUpdate = { ...replacement, name: 'external.png', updatedAt: '3' }
  render(externalUpdate)
  tree = render(externalUpdate)
  assert.equal(find(tree, nameInput).props.value, 'my unsaved name')
})

test('revision endpoint tracks writes made outside the panel and state carries it', async () => {
  await withBoard(async ({ request }) => {
    const first = await request('GET', '/api/revision')
    assert.equal(first.status, 200)
    assert.equal(first.body.ok, true)
    assert.ok(Number.isSafeInteger(first.body.revision) && first.body.revision >= 1, 'the activation load must set a positive revision')
    assert.equal(first.body.images, 0)
    assert.equal((await request('GET', '/api/state')).body.revision, first.body.revision)

    const created = await request('POST', '/api/images', upload)
    const second = await request('GET', '/api/revision')
    assert.ok(second.body.revision > first.body.revision, 'an external upload must bump the revision')
    assert.equal(second.body.images, 1)
    assert.match(second.body.updatedAt, /^\d{4}-\d\d-\d\dT/)

    // Reads never bump the revision, so a polling client stays quiet.
    assert.equal((await request('GET', '/api/revision')).body.revision, second.body.revision)

    await request('PATCH', '/api/images/' + created.body.image.id, { pinned: true, tags: ['quiet'] })
    const third = await request('GET', '/api/revision')
    assert.ok(third.body.revision > second.body.revision, 'an external patch must bump the revision')

    await request('DELETE', '/api/images/' + created.body.image.id)
    const fourth = await request('GET', '/api/revision')
    assert.ok(fourth.body.revision > third.body.revision, 'an external delete must bump the revision')
    assert.equal(fourth.body.images, 0)
  })
})

test('0.2.11 quiet star-suite link replaces the timed popup', async () => {
  const client = await read('client.js')
  for (const expected of ['STAR_SUITE_URL', "starSuite: '", "starSuiteTitle: '"]) {
    assert.ok(client.includes(expected), `client source must reference ${expected}`)
  }
  for (const removed of ['dsh-stijnus-star-cta/v1', 'StarSuiteCta', "ctx.slots.inject('shell.overlay'"]) {
    assert.ok(!client.includes(removed), `client source must not contain ${removed}`)
  }
  assert.match(client, /https:\/\/github\.com\/Stijnus\?tab=repositories&q=dsh/)
})

test('0.2.9 live board sync is wired on both halves', async () => {
  const host = await read('index.js')
  for (const anchor of ['handleRevision', "case 'revision'", 'getRevision']) {
    assert.ok(host.includes(anchor), `host source must reference ${anchor}`)
  }
  const client = await read('client.js')
  for (const anchor of [
    '/moodboard/api/revision',
    'REVISION_POLL_MS',
    'startBoardSync',
    'stopBoardSync',
    'pullBoardRevision',
    'visibilitychange',
  ]) {
    assert.ok(client.includes(anchor), `client source must reference ${anchor}`)
  }
  // The lifecycle wiring, not just the declarations: activation starts the poll
  // and disposal removes it (whitespace-normalized so reformatting is safe).
  assert.match(client, /ctx\.effect\(\(\) => startBoardSync\(\)\)/)
  assert.match(client, /stopBoardSync\(\)\s*\n\s*disposeImageUrls\(\)/)
})

/** Resolve after the microtask queue (and one macrotask) has drained. */
async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

const jsonResponse = (payload) => ({ ok: true, status: 200, json: async () => payload })

async function loadClientModule(fetch, extraContext = {}, extraWindow = {}) {
  let plugin
  const window = {
    ...extraWindow,
    __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => ({})) } },
  }
  const source = (await read('client.js')).replace(
    "inject: ['slots', 'locale'],",
    "inject: ['slots', 'locale'], pullBoardRevision, getSnapshot, refresh, startBoardSync, stopBoardSync, applyBoard, setState, " +
      'patchImage, setPinned, removeImage, reorderImages, uploadFiles, trackPageMount, hostTagList, ' +
      'selectSingleImage, toggleSelectedImage, selectRangeTo, selectAllImages, invertSelectedImages, clearSelection,',
  )
  runInNewContext(source, { window, fetch, ...extraContext })
  return plugin
}

function eventTarget(initial = {}) {
  const listeners = new Map()
  return {
    ...initial,
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0
    },
    emit(type) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener({ type })
    },
  }
}

test('client polls the revision and silently adopts external board writes', async () => {
  let revision = 1
  let serverBoard = { version: 1, updatedAt: 'one', images: [] }
  const calls = []
  let failRevision = false
  let deferState = false
  let releaseState = () => {}
  const fetch = async (url) => {
    const path = String(url)
    calls.push(path)
    if (path.endsWith('/api/revision')) {
      if (failRevision) throw new Error('offline')
      return jsonResponse({ ok: true, revision, updatedAt: serverBoard.updatedAt, images: serverBoard.images.length })
    }
    if (deferState) {
      deferState = false
      await new Promise((resolve) => {
        releaseState = resolve
      })
    }
    return jsonResponse({ ok: true, revision, board: serverBoard })
  }
  const plugin = await loadClientModule(fetch)
  await plugin.refresh()
  assert.equal(plugin.getSnapshot().board.images.length, 0)
  assert.deepEqual(calls, ['/moodboard/api/state'])

  calls.length = 0
  assert.equal(await plugin.pullBoardRevision(), false)
  assert.deepEqual(calls, ['/moodboard/api/revision'], 'an unchanged revision must not re-read the board')

  // Uploads and mutations in flight are never interrupted by a poll.
  plugin.setState({ uploading: true })
  calls.length = 0
  assert.equal(await plugin.pullBoardRevision(), false)
  assert.deepEqual(calls, [], 'a poll must not run while an upload is in flight')
  plugin.setState({ uploading: false })

  // The revision resets when the Host reloads, so a newer board timestamp must
  // still trigger a state read.
  serverBoard = { version: 1, updatedAt: 'one-b', images: [] }
  calls.length = 0
  assert.equal(await plugin.pullBoardRevision(), true)
  assert.deepEqual(calls, ['/moodboard/api/revision', '/moodboard/api/state'])

  // An agent uploads a reference: the next check pulls the full board silently.
  revision = 2
  serverBoard = {
    version: 1,
    updatedAt: 'two',
    images: [{ id: 'mb_0123456789ab', name: 'agent.png', imageUrl: '/moodboard/image/mb_0123456789ab?v=abc' }],
  }
  calls.length = 0
  deferState = true
  const pendingPoll = plugin.pullBoardRevision()
  await flushAsync()
  assert.equal(plugin.getSnapshot().loading, false, 'the silent refresh must not show the loading state')
  assert.equal(plugin.getSnapshot().board.images.length, 0, 'the current board stays visible while the read is in flight')
  releaseState()
  assert.equal(await pendingPoll, true)
  assert.equal(plugin.getSnapshot().board.images.length, 1)
  assert.equal(plugin.getSnapshot().board.images[0].name, 'agent.png')
  assert.equal(plugin.getSnapshot().loading, false)
  assert.equal(plugin.getSnapshot().error, '')
  assert.deepEqual(calls, ['/moodboard/api/revision', '/moodboard/api/state'])

  // A transient poll failure stays invisible while a board is loaded.
  failRevision = true
  assert.equal(await plugin.pullBoardRevision(), false)
  assert.equal(plugin.getSnapshot().board.images.length, 1)
  assert.equal(plugin.getSnapshot().error, '')
})

test('a poll never supersedes an in-flight full refresh and leaves no loading state behind', async () => {
  let stateCalls = 0
  let releaseState = () => {}
  const fetch = async (url) => {
    const path = String(url)
    if (path.endsWith('/api/revision')) {
      return jsonResponse({ ok: true, revision: 2, updatedAt: 'two', images: 0 })
    }
    stateCalls += 1
    if (stateCalls === 1) {
      await new Promise((resolve) => {
        releaseState = resolve
      })
    }
    return { ok: false, status: 500, json: async () => ({ ok: false, error: { code: 'storage-failed', message: 'boom' } }) }
  }
  const plugin = await loadClientModule(fetch)
  const slowRefresh = plugin.refresh()
  await flushAsync()
  assert.equal(plugin.getSnapshot().loading, true)

  // The revision changed, but the full refresh owns the read: the poll waits.
  assert.equal(await plugin.pullBoardRevision(), false)
  assert.equal(stateCalls, 1, 'the poll must not start a second state read')

  releaseState()
  await slowRefresh
  assert.equal(plugin.getSnapshot().loading, false, 'the failed full refresh must clear the loading state')
  assert.notEqual(plugin.getSnapshot().error, '')
})

test('a poll lets a full refresh that started during its revision read win', async () => {
  let stateCalls = 0
  let revisionCalls = 0
  let releaseRevision = () => {}
  let releaseState = () => {}
  let serverBoard = { version: 1, updatedAt: 'one', images: [] }
  const fetch = async (url) => {
    const path = String(url)
    if (path.endsWith('/api/revision')) {
      revisionCalls += 1
      if (revisionCalls === 1) {
        await new Promise((resolve) => {
          releaseRevision = resolve
        })
      }
      return jsonResponse({ ok: true, revision: 2, updatedAt: serverBoard.updatedAt, images: serverBoard.images.length })
    }
    stateCalls += 1
    if (stateCalls === 2) {
      await new Promise((resolve) => {
        releaseState = resolve
      })
    }
    return jsonResponse({ ok: true, revision: stateCalls === 1 ? 1 : 2, board: serverBoard })
  }
  const plugin = await loadClientModule(fetch)
  await plugin.refresh()
  assert.equal(stateCalls, 1)

  // The poll starts first and its revision read is slow.
  const poll = plugin.pullBoardRevision()
  await flushAsync()
  // A mutation-triggered full refresh starts while that read is in flight.
  serverBoard = {
    version: 1,
    updatedAt: 'two',
    images: [{ id: 'mb_0123456789ab', name: 'fresh.png', imageUrl: '/moodboard/image/mb_0123456789ab?v=2' }],
  }
  const fullRefresh = plugin.refresh()
  await flushAsync()
  assert.equal(plugin.getSnapshot().loading, true)

  releaseRevision()
  assert.equal(await poll, false, 'the poll must defer to the full refresh')
  assert.equal(stateCalls, 2, 'the poll must not start its own silent state read')

  releaseState()
  await fullRefresh
  assert.equal(stateCalls, 2)
  assert.equal(plugin.getSnapshot().loading, false)
  assert.equal(plugin.getSnapshot().board.images[0].name, 'fresh.png')
})

test('client auto-recovers a failed activation read and clears the load error', async () => {
  let failing = true
  const board = {
    version: 1,
    updatedAt: 'one',
    images: [{ id: 'mb_0123456789ab', name: 'recovered.png', imageUrl: '/moodboard/image/mb_0123456789ab?v=1' }],
  }
  const fetch = async (url) => {
    if (failing) {
      return { ok: false, status: 500, json: async () => ({ ok: false, error: { code: 'storage-failed', message: 'boom' } }) }
    }
    if (String(url).endsWith('/api/revision')) return jsonResponse({ ok: true, revision: 1, updatedAt: board.updatedAt, images: 1 })
    return jsonResponse({ ok: true, revision: 1, board })
  }
  const plugin = await loadClientModule(fetch)
  await plugin.refresh()
  assert.equal(plugin.getSnapshot().board, null)
  assert.notEqual(plugin.getSnapshot().error, '')

  failing = false
  assert.equal(await plugin.pullBoardRevision(), true)
  assert.equal(plugin.getSnapshot().board.images[0].name, 'recovered.png')
  assert.equal(plugin.getSnapshot().error, '', 'the stale load error must clear once the board arrives')
})

test('foreground board sync checks on visibility return and pauses while hidden', async () => {
  let revision = 1
  let serverBoard = { version: 1, updatedAt: 'one', images: [] }
  const calls = []
  const fetch = async (url) => {
    calls.push(String(url))
    if (String(url).endsWith('/api/revision')) {
      return jsonResponse({ ok: true, revision, updatedAt: serverBoard.updatedAt, images: serverBoard.images.length })
    }
    return jsonResponse({ ok: true, revision, board: serverBoard })
  }
  const intervals = []
  const cleared = []
  const context = {
    document: eventTarget({ visibilityState: 'visible' }),
    setInterval: (callback, delay) => {
      intervals.push({ callback, delay })
      return { unref() {} }
    },
    clearInterval: (timer) => cleared.push(timer),
  }
  const windowEvents = eventTarget()
  const plugin = await loadClientModule(fetch, context, windowEvents)
  await plugin.refresh()
  assert.equal(plugin.getSnapshot().board.images.length, 0)

  const stop = plugin.startBoardSync()
  assert.equal(typeof stop, 'function')
  assert.equal(intervals.length, 1)
  assert.equal(intervals[0].delay, 3000)
  assert.equal(context.document.listenerCount('visibilitychange'), 1)
  assert.equal(windowEvents.listenerCount('focus'), 1)

  // A visible tick with a new revision applies the external upload.
  revision = 2
  serverBoard = {
    version: 1,
    updatedAt: 'two',
    images: [{ id: 'mb_0123456789ab', name: 'agent.png', imageUrl: '/moodboard/image/mb_0123456789ab?v=abc' }],
  }
  intervals[0].callback()
  await flushAsync()
  assert.equal(plugin.getSnapshot().board.images.length, 1)

  // While the document is hidden the timer does not poll at all.
  calls.length = 0
  context.document.visibilityState = 'hidden'
  revision = 3
  intervals[0].callback()
  await flushAsync()
  assert.deepEqual(calls, [])

  // Returning to the tab checks immediately instead of waiting for the ticker.
  context.document.visibilityState = 'visible'
  serverBoard = {
    version: 1,
    updatedAt: 'three',
    images: [
      { id: 'mb_0123456789ab', name: 'a.png', imageUrl: '/moodboard/image/a?v=1' },
      { id: 'mb_0123456789ac', name: 'b.png', imageUrl: '/moodboard/image/b?v=1' },
    ],
  }
  revision = 4
  context.document.emit('visibilitychange')
  await flushAsync()
  assert.equal(plugin.getSnapshot().board.images.length, 2)

  // Window focus checks immediately too.
  revision = 5
  serverBoard = {
    version: 1,
    updatedAt: 'five',
    images: [{ id: 'mb_0123456789ab', name: 'a.png', imageUrl: '/moodboard/image/a?v=1' }],
  }
  windowEvents.emit('focus')
  await flushAsync()
  assert.equal(plugin.getSnapshot().board.images.length, 1)

  plugin.stopBoardSync()
  assert.equal(cleared.length, 1)
  assert.equal(context.document.listenerCount('visibilitychange'), 0)
  assert.equal(windowEvents.listenerCount('focus'), 0)
  assert.equal(windowEvents.listenerCount('online'), 0)
})

test('a silent state-read failure keeps the loaded board and hides the error', async () => {
  let revision = 1
  let serverBoard = { version: 1, updatedAt: 'one', images: [] }
  let failState = false
  const fetch = async (url) => {
    const path = String(url)
    if (path.endsWith('/api/revision')) {
      return jsonResponse({ ok: true, revision, updatedAt: serverBoard.updatedAt, images: serverBoard.images.length })
    }
    if (failState) {
      return { ok: false, status: 500, json: async () => ({ ok: false, error: { code: 'storage-failed', message: 'boom' } }) }
    }
    return jsonResponse({ ok: true, revision, board: serverBoard })
  }
  const plugin = await loadClientModule(fetch)
  await plugin.refresh()
  assert.equal(plugin.getSnapshot().board.images.length, 0)

  // A transient state read during a poll must not turn into a load-error banner.
  revision = 2
  failState = true
  await plugin.pullBoardRevision()
  assert.equal(plugin.getSnapshot().board.images.length, 0, 'the loaded board must be kept')
  assert.equal(plugin.getSnapshot().loading, false)
  assert.equal(plugin.getSnapshot().error, '')

  // With no board loaded yet the same failure must still report the load error.
  const broken = await loadClientModule(async (url) => {
    if (String(url).endsWith('/api/revision')) return jsonResponse({ ok: true, revision: 1, updatedAt: null, images: 0 })
    return { ok: false, status: 500, json: async () => ({ ok: false, error: { code: 'storage-failed', message: 'boom' } }) }
  })
  assert.equal(await broken.pullBoardRevision(), false)
  assert.equal(broken.getSnapshot().board, null)
  assert.equal(broken.getSnapshot().loading, false)
  assert.notEqual(broken.getSnapshot().error, '')
})

test('a revision read is aborted after the timeout and the next poll still works', async () => {
  let revision = 1
  let serverBoard = { version: 1, updatedAt: 'one', images: [] }
  let aborted = 0
  const fetch = async (url, init) => {
    const path = String(url)
    if (path.endsWith('/api/revision')) {
      if (init !== undefined && init.signal !== undefined && init.signal.aborted) {
        aborted += 1
        throw new Error('aborted')
      }
      return jsonResponse({ ok: true, revision, updatedAt: serverBoard.updatedAt, images: serverBoard.images.length })
    }
    return jsonResponse({ ok: true, revision, board: serverBoard })
  }
  let timeouts = 0
  let cleared = 0
  const context = {
    AbortController,
    setTimeout: (callback) => {
      timeouts += 1
      if (timeouts === 1) callback()
      return timeouts
    },
    clearTimeout: () => {
      cleared += 1
    },
  }
  const plugin = await loadClientModule(fetch, context)
  await plugin.refresh()
  assert.equal(await plugin.pullBoardRevision(), false, 'an aborted revision read reports no change')
  assert.equal(timeouts, 1, 'the revision read must be given a deadline')
  assert.equal(aborted, 1, 'the deadline must abort the in-flight read')
  assert.equal(cleared, 1, 'the deadline timer must be cleared when the read settles')
  assert.equal(plugin.getSnapshot().error, '')

  // The abort released the busy flag, so a real change is picked up next tick.
  revision = 2
  serverBoard = {
    version: 1,
    updatedAt: 'two',
    images: [{ id: 'mb_0123456789ab', name: 'later.png', imageUrl: '/moodboard/image/mb_0123456789ab?v=2' }],
  }
  assert.equal(await plugin.pullBoardRevision(), true)
  assert.equal(timeouts, 2)
  assert.equal(cleared, 2)
  assert.equal(plugin.getSnapshot().board.images[0].name, 'later.png')
})

/**
 * Run the Host half behind a real HTTP server with a temporary `DSH_HOME`, so a
 * test can reproduce the reported flow: an external caller (the agent) uploads
 * over HTTP while the client half polls the revision endpoint.
 */
async function withHttpBoard(run) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-moodboard-http-'))
  const oldHome = process.env.DSH_HOME
  let server
  try {
    process.env.DSH_HOME = root
    let handler
    const imageBytes = new Map()
    apply({
      effect: (fn) => fn(),
      webServer: { register: (route) => { handler = route.handler; return () => {} } },
      tools: { register: () => () => {} },
      systemPrompt: { section: () => () => {} },
      connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
      logger: { warn() {} },
      attachments: {
        saveImage: async ({ data, mediaType, name }) => {
          const attachmentId = createHash('sha256').update(data).digest('hex')
          imageBytes.set(attachmentId, data)
          return { attachmentId, bytes: data.length, mediaType, name, width: 1, height: 1 }
        },
        readImage: async (ref) => ({ ref, data: imageBytes.get(ref.attachmentId) }),
      },
    })
    server = createServer((request, response) => handler(request, response))
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    await run({ origin })
  } finally {
    if (server !== undefined) await new Promise((resolve) => server.close(resolve))
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    await rm(root, { recursive: true, force: true })
  }
}

test('an agent upload over real HTTP reaches the polling client without a reload', async () => {
  await withHttpBoard(async ({ origin }) => {
    // The client runs in a VM with the real fetch pointed at the test origin.
    const plugin = await loadClientModule((path, init) => fetch(origin + path, init))
    await plugin.refresh()
    assert.equal(plugin.getSnapshot().board.images.length, 0)

    const created = await fetch(origin + '/moodboard/api/images', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...upload, name: 'agent-added.png', tags: ['agent'] }),
    })
    assert.equal(created.status, 200)
    assert.equal((await created.json()).ok, true)

    // This is the regression: before the fix the client never noticed the write.
    assert.equal(await plugin.pullBoardRevision(), true)
    assert.equal(plugin.getSnapshot().board.images.length, 1)
    assert.equal(plugin.getSnapshot().board.images[0].name, 'agent-added.png')
    assert.equal(plugin.getSnapshot().loading, false)
    assert.equal(plugin.getSnapshot().error, '')

    // The same revision must not re-read the board on the next tick.
    assert.equal(await plugin.pullBoardRevision(), false)

    // An external pin (PATCH) is adopted on the next tick too.
    const patched = await fetch(origin + '/moodboard/api/images/' + plugin.getSnapshot().board.images[0].id, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    })
    assert.equal(patched.status, 200)
    assert.equal(await plugin.pullBoardRevision(), true)
    assert.equal(plugin.getSnapshot().board.images[0].pinned, true)
  })
})

// ---------------------------------------------------------------------------
// 0.3.0 — inspiration intake (host half)
// ---------------------------------------------------------------------------

/** A real 1x1 PNG, used as the fake upstream image payload. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const IMPORT_PAGE_URL = 'https://93.184.216.34/preview'
const IMPORT_IMAGE_URL = 'https://93.184.216.34/hero.png'

/** Deterministic fetch for capture tests: fake HTML pages + one fake image. */
function fakeImportFetch(pages, imageUrl = IMPORT_IMAGE_URL, imageBytes = PNG_BYTES) {
  const fetchImpl = async (url) => {
    const key = String(url)
    const html = pages.get(key)
    if (html !== undefined) {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    if (key === imageUrl) {
      return new Response(imageBytes, { status: 200, headers: { 'content-type': 'image/png' } })
    }
    // `…/hero-<n>.png` serves distinct bytes per n (imports dedupe by content).
    const numbered = /\/hero-(\d+)\.png$/u.exec(key)
    if (numbered !== null) {
      const bytes = Buffer.concat([imageBytes, Buffer.from([Number(numbered[1]) & 0xff])])
      return new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } })
    }
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  }
  fetchImpl.calls = []
  const tracked = async (url, init) => {
    fetchImpl.calls.push(String(url))
    return fetchImpl(url, init)
  }
  tracked.calls = fetchImpl.calls
  return tracked
}

/** Fake HTML page whose OG metadata points at the fake image URL. */
function previewPage({ title, description, imageUrl = IMPORT_IMAGE_URL, siteName = 'Studio Example' }) {
  return `<!doctype html><html><head><title>Fallback title</title>
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${imageUrl}">
<meta property="og:site_name" content="${siteName}">
</head><body></body></html>`
}

/** Run a callback with a deterministic default transport installed for the Host routes. */
async function withFakeFetch(pages, run, imageUrl) {
  const fetchImpl = fakeImportFetch(pages, imageUrl)
  const restore = setDefaultFetch(fetchImpl)
  try {
    await run(fetchImpl)
  } finally {
    restore()
  }
}

async function withCleanMobbinKey(run) {
  const previous = process.env.MOBBIN_API_KEY
  delete process.env.MOBBIN_API_KEY
  try {
    await run()
  } finally {
    if (previous === undefined) delete process.env.MOBBIN_API_KEY
    else process.env.MOBBIN_API_KEY = previous
  }
}

test('GET /api/sources reports availability, the config path and the workflow, re-reading config live', async () => {
  await withBoard(async ({ request, root }) => {
    await withCleanMobbinKey(async () => {
      const first = await request('GET', '/api/sources')
      assert.equal(first.status, 200)
      assert.equal(first.body.ok, true)
      assert.equal(first.body.configPath, join(root, 'moodboard/sources.json'))
      assert.ok(first.body.workflow.length > 0 && first.body.workflow.length <= 2200)
      assert.match(first.body.workflow, /Reference-to-component workflow/)
      assert.match(first.body.workflow, /borrow/)
      assert.match(first.body.workflow, /branding, copy, logos and assets/)

      const byId = Object.fromEntries(first.body.sources.map((source) => [source.id, source]))
      assert.equal(byId.web.available, true)
      assert.equal(byId.arena.available, true)
      assert.equal(byId.mobbin.available, false)
      assert.match(byId.mobbin.detail, /MOBBIN_API_KEY/)
      assert.equal(byId.dribbble.available, false)

      // The config file is re-read on every call, so no Host restart is needed.
      await mkdir(join(root, 'moodboard'), { recursive: true })
      await writeFile(join(root, 'moodboard/sources.json'), JSON.stringify({ mobbinApiKey: 'file-key' }))
      const second = await request('GET', '/api/sources')
      assert.equal(second.body.sources.find((source) => source.id === 'mobbin').available, true)

      // The environment key wins over the file.
      await rm(join(root, 'moodboard/sources.json'))
      process.env.MOBBIN_API_KEY = 'env-key'
      try {
        const third = await request('GET', '/api/sources')
        assert.equal(third.body.sources.find((source) => source.id === 'mobbin').available, true)
      } finally {
        delete process.env.MOBBIN_API_KEY
      }
    })
  })
})

test('POST /api/import captures a link preview, merges metadata, persists bytes and dedupes by sourceUrl', async () => {
  await withBoard(async ({ request, root }) => {
    const pages = new Map([
      [IMPORT_PAGE_URL, previewPage({ title: 'Editorial dashboard reference', description: 'Calm spacing and warm neutrals.' })],
    ])
    await withFakeFetch(pages, async () => {
      const result = await request('POST', '/api/import', {
        urls: [IMPORT_PAGE_URL],
        tags: ['dashboard'],
        notes: 'Keep the spacing rhythm',
        pinned: true,
      })
      assert.equal(result.status, 200)
      assert.equal(result.body.ok, true)
      assert.deepEqual(result.body.failures, [])
      assert.equal(result.body.duplicates.length, 0)
      assert.equal(result.body.imported.length, 1)
      const image = result.body.imported[0]
      assert.equal(image.sourceUrl, IMPORT_PAGE_URL)
      assert.equal(image.name, 'Editorial dashboard reference')
      assert.deepEqual(image.tags, ['web', '93.184.216.34', 'dashboard'])
      assert.ok(image.notes.startsWith('Keep the spacing rhythm\n\n'), 'user notes come first')
      assert.match(image.notes, /Captured from Studio Example/)
      assert.equal(image.pinned, true)
      assert.equal(image.mediaType, 'image/png')
      assert.ok(image.bytes > 0)

      // The normalized attachment reference is persisted on the board...
      const board = JSON.parse(await readFile(join(root, 'moodboard/board.json'), 'utf8'))
      assert.equal(board.images.length, 1)
      assert.equal(board.images[0].sourceUrl, IMPORT_PAGE_URL)
      assert.equal(board.images[0].attachment.mediaType, 'image/png')
      assert.ok(board.images[0].attachment.attachmentId.length > 0)
      // ...and the stored bytes are served back through the image route.
      const served = await request('GET', image.imageUrl.replace('/moodboard', ''))
      assert.equal(served.status, 200)
      assert.deepEqual(Buffer.from(served.body), PNG_BYTES)

      // A second request for the same URL is a duplicate, not a new image.
      const again = await request('POST', '/api/import', { urls: [IMPORT_PAGE_URL] })
      assert.equal(again.status, 200)
      assert.equal(again.body.imported.length, 0)
      assert.equal(again.body.duplicates.length, 1)
      assert.equal(again.body.duplicates[0].id, image.id)
      assert.equal((await request('GET', '/api/state')).body.board.images.length, 1)

      // Item failures keep HTTP 200 and never abort the request.
      const failed = await request('POST', '/api/import', { urls: ['not-a-url'] })
      assert.equal(failed.status, 200)
      assert.equal(failed.body.ok, true)
      assert.equal(failed.body.imported.length, 0)
      assert.equal(failed.body.failures.length, 1)
      assert.equal(failed.body.failures[0].code, 'invalid-url')
    })

    // Malformed requests still use the normal error envelope.
    const mixed = await request('POST', '/api/import', { urls: [IMPORT_PAGE_URL], paths: ['/tmp/x.png'] })
    assert.equal(mixed.status, 400)
    assert.equal(mixed.body.error.code, 'invalid-body')
    const badLimit = await request('POST', '/api/import', { source: 'arena', query: 'dashboard', limit: 99 })
    assert.equal(badLimit.status, 400)
    assert.equal(badLimit.body.error.code, 'invalid-body')
  })
})

test('POST /api/import imports local screenshot paths and reports per-file failures', async () => {
  await withBoard(async ({ request, root }) => {
    const fixture = join(root, 'capture.png')
    const result = await request('POST', '/api/import', { paths: [fixture], tags: ['local'], notes: 'Captured with browser MCP' })
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.imported.length, 1)
    const image = result.body.imported[0]
    assert.equal(image.name, 'capture.png')
    assert.equal(image.sourceUrl, '')
    assert.deepEqual(image.tags, ['file', 'local'])
    assert.equal(image.notes, 'Captured with browser MCP')

    const missing = await request('POST', '/api/import', { paths: [join(root, 'missing.png')] })
    assert.equal(missing.status, 200)
    assert.equal(missing.body.imported.length, 0)
    assert.equal(missing.body.failures.length, 1)
    assert.equal(missing.body.failures[0].code, 'file-not-found')
  }, async (dir) => {
    await copyFile(new URL('test/fixtures/harness-light-reference.png', root), join(dir, 'capture.png'))
  })
})

test('import reports duplicates before stopping at the board capacity limit', async () => {
  const secondUrl = 'https://93.184.216.34/second'
  const pages = new Map([
    [IMPORT_PAGE_URL, previewPage({ title: 'Duplicated reference', description: 'Already collected.' })],
    [secondUrl, previewPage({ title: 'Fresh reference', description: 'Would be new.' })],
  ])
  await withBoard(async ({ request }) => {
    await withFakeFetch(pages, async () => {
      const result = await request('POST', '/api/import', { urls: [IMPORT_PAGE_URL, secondUrl] })
      assert.equal(result.status, 200)
      assert.equal(result.body.ok, true)
      assert.equal(result.body.imported.length, 0)
      assert.equal(result.body.duplicates.length, 1, 'a reference already on the board is a duplicate even when full')
      assert.equal(result.body.duplicates[0].sourceUrl, IMPORT_PAGE_URL)
      assert.equal(result.body.failures.length, 1)
      assert.equal(result.body.failures[0].code, 'board-full')
    })
  }, async (dir) => {
    const images = []
    for (let index = 0; index < 200; index += 1) {
      images.push({
        id: `mb_${index.toString(16).padStart(12, '0')}`,
        name: `reference-${index}.png`,
        attachment: { attachmentId: `att-${index}`, mediaType: 'image/png', bytes: 10, width: 1, height: 1 },
        tags: [],
        notes: '',
        sourceUrl: index === 0 ? IMPORT_PAGE_URL : '',
        pinned: false,
        order: index,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    }
    await mkdir(join(dir, 'moodboard'), { recursive: true })
    await writeFile(
      join(dir, 'moodboard/board.json'),
      JSON.stringify({ version: 1, updatedAt: '2026-01-01T00:00:00.000Z', nextOrder: 200, images }),
    )
  })
})

test('POST /api/import refuses an unavailable search source with the route-level 503 code', async () => {
  await withBoard(async ({ request }) => {
    await withCleanMobbinKey(async () => {
      const result = await request('POST', '/api/import', { source: 'mobbin', query: 'checkout paywall' })
      assert.equal(result.status, 503)
      assert.equal(result.body.ok, false)
      assert.equal(result.body.error.code, 'source-unavailable')
      assert.match(result.body.error.message, /MOBBIN_API_KEY/)
    })
  })
})

test('moodboard tool imports, lists sources and returns the workflow; import image blocks cap at six', async () => {
  await withBoard(async ({ tool }) => {
    const pages = new Map()
    for (let index = 1; index <= 7; index += 1) {
      pages.set(
        `https://93.184.216.34/p${index}`,
        previewPage({
          title: `Reference ${index}`,
          description: `Idea number ${index}.`,
          imageUrl: `https://93.184.216.34/hero-${index}.png`,
        }),
      )
    }
    await withFakeFetch(pages, async () => {
      const imported = await tool.execute({ action: 'import', urls: [...pages.keys()], tags: ['batch'], pinned: true })
      assert.equal(imported.ok, true)
      assert.equal(imported.action, 'import')
      assert.equal(imported.total, 7)
      assert.equal(imported.fallback, false)
      assert.equal(imported.images.length, 7)
      assert.deepEqual(imported.duplicates, [])
      assert.deepEqual(imported.failures, [])
      assert.ok(imported.images.every((image) => image.tags.includes('batch')))
      assert.ok(imported.images.every((image) => image.pinned))

      const blocks = tool.output.render({ action: 'import' }, imported)
      assert.equal(blocks[0].type, 'text')
      assert.match(blocks[0].text, /Imported 7 references/)
      assert.equal(blocks.filter((block) => block.type === 'image').length, 6)
      assert.equal(blocks[1].attachment.attachmentId, imported.images[0].attachment.attachmentId)
      assert.match(blocks.at(-1).text, /1 more imported reference image/)
    })

    const sources = await tool.execute({ action: 'sources' })
    assert.equal(sources.ok, true)
    assert.equal(sources.action, 'sources')
    assert.ok(sources.sources.some((source) => source.id === 'web'))
    assert.match(sources.brief, /MOBBIN_API_KEY/)
    assert.match(sources.brief, /Browser MCP bridge/)
    assert.match(sources.brief, /Config: /)
    const sourceBlocks = tool.output.render({ action: 'sources' }, sources)
    assert.equal(sourceBlocks.length, 1)
    assert.equal(sourceBlocks[0].type, 'text')

    const workflow = await tool.execute({ action: 'workflow' })
    assert.equal(workflow.ok, true)
    assert.equal(workflow.action, 'workflow')
    assert.equal(workflow.workflow, workflow.brief.split('\n\n---\n\n')[0])
    assert.match(workflow.brief, /Reference-to-component workflow/)
    assert.match(workflow.brief, /Active moodboard style guide \(7 pinned references\)/)
    assert.equal(tool.output.render({ action: 'workflow' }, workflow).length, 1)

    // The import action requires exactly one intake mode.
    await assert.rejects(tool.execute({ action: 'import' }), /exactly one/)
    await assert.rejects(tool.execute({ action: 'import', urls: [], paths: ['/tmp/x.png'] }), /exactly one/)
    await assert.rejects(tool.execute({ action: 'import', source: 'arena', query: '' }), /query/)
  })
})

test('tool import reports an unavailable source as a tool value instead of crashing', async () => {
  await withBoard(async ({ tool }) => {
    await withCleanMobbinKey(async () => {
      const value = await tool.execute({ action: 'import', source: 'mobbin', query: 'paywall checkout' })
      assert.equal(value.ok, false)
      assert.equal(value.action, 'import')
      assert.equal(value.error.code, 'source-unavailable')
      assert.match(value.error.message, /MOBBIN_API_KEY/)
      const blocks = tool.output.render({ action: 'import' }, value)
      assert.equal(blocks.length, 1)
      assert.equal(blocks[0].type, 'text')
      assert.match(blocks[0].text, /MOBBIN_API_KEY/)
    })
  })
})

test('the inspiration-workflow prompt section appears with image blocks and drops on an empty board', async () => {
  await withBoard(async ({ request, sections }) => {
    const byName = (name) => sections.find((section) => section.name === name)
    assert.equal(sections.length, 2)
    const styleGuide = byName('moodboard:style-guide')
    const inspiration = byName('moodboard:inspiration-workflow')
    assert.equal(styleGuide.order, 2450)
    assert.equal(inspiration.order, 2455)
    assert.equal(await styleGuide.text(), '')
    assert.equal(await inspiration.text(), '')

    await request('POST', '/api/images', upload)
    const text = await inspiration.text()
    assert.ok(text.length > 0 && text.length <= 700, `inspiration section must be 1..700 chars, got ${text.length}`)
    assert.match(text, /pinned moodboard references define/)
    assert.match(text, /borrow/)
    assert.match(text, /avoid/)
    assert.match(text, /branding, copy, logos, assets/)
    assert.match(text, /action: "import"/)
    assert.match(text, /action: "workflow"/)
    assert.ok(!text.includes('Reference-to-component workflow'), 'the prompt must not repeat the whole workflow')
    assert.match(await styleGuide.text(), /action: "active"/)
  })
})

// ---------------------------------------------------------------------------
// 0.4.3 — write lock, tool presentation
// ---------------------------------------------------------------------------

/** A gate that holds the next attachment save open until `release()`. */
function holdNextSave(hooks) {
  let entered
  let release
  const started = new Promise((resolve) => { entered = resolve })
  const gate = new Promise((resolve) => { release = resolve })
  hooks.beforeSave = async () => {
    hooks.beforeSave = null
    entered()
    await gate
  }
  return { started, release }
}

test('a slow image save does not block other board edits', async () => {
  await withBoard(async ({ request, hooks }) => {
    const first = (await request('POST', '/api/images', upload)).body.image
    const held = holdNextSave(hooks)
    const pending = request('POST', '/api/images', { ...upload, data: Buffer.from('second').toString('base64'), name: 'second.png' })
    await held.started

    // Before the fix this PATCH queued behind the held save and never finished here.
    const patched = await request('PATCH', '/api/images/' + first.id, { pinned: true })
    assert.equal(patched.status, 200)
    assert.equal(patched.body.image.pinned, true)

    held.release()
    const created = await pending
    assert.equal(created.status, 200)
    const state = (await request('GET', '/api/state')).body.board
    assert.equal(state.images.length, 2)
    assert.equal(state.images.find((image) => image.id === first.id).pinned, true)
  })
})

test('replace checks the target before storing bytes and re-checks it at commit', async () => {
  await withBoard(async ({ request, hooks, imageBytes }) => {
    const before = imageBytes.size
    const missing = await request('POST', '/api/images/mb_000000000000/replace', upload)
    assert.equal(missing.status, 404)
    assert.equal(imageBytes.size, before, 'no bytes are stored for an unknown image')

    const image = (await request('POST', '/api/images', upload)).body.image
    const held = holdNextSave(hooks)
    const pending = request('POST', '/api/images/' + image.id + '/replace', { ...upload, data: Buffer.from('next').toString('base64') })
    await held.started
    assert.equal((await request('DELETE', '/api/images/' + image.id)).status, 200)
    held.release()
    assert.equal((await pending).status, 404)
  })
})

test('an import re-checks duplicates against writes that landed while it saved', async () => {
  await withBoard(async ({ request, hooks }) => {
    const pages = new Map([[IMPORT_PAGE_URL, previewPage({ title: 'Race reference', description: 'Raced.' })]])
    await withFakeFetch(pages, async () => {
      const held = holdNextSave(hooks)
      const pending = request('POST', '/api/import', { urls: [IMPORT_PAGE_URL] })
      await held.started
      // The same source lands through a plain upload while the import is saving.
      const direct = await request('POST', '/api/images', { ...upload, sourceUrl: IMPORT_PAGE_URL })
      assert.equal(direct.status, 200)
      held.release()

      const result = await pending
      assert.equal(result.status, 200)
      assert.equal(result.body.imported.length, 0)
      assert.equal(result.body.duplicates.length, 1)
      assert.equal(result.body.duplicates[0].id, direct.body.image.id)
      assert.equal((await request('GET', '/api/state')).body.board.images.length, 1)
    })
  })
})

test('the tool presents import as a non-read call and every other action as a read', async () => {
  await withBoard(async ({ tool }) => {
    assert.equal(tool.presentCall({ action: 'import', urls: ['https://example.com'] }).kind, 'other')
    for (const action of ['active', 'list', 'query', 'get', 'brief', 'sources', 'workflow']) {
      assert.equal(tool.presentCall({ action }).kind, 'read', action)
    }
    assert.equal(tool.presentCall({}).kind, 'read')
  })
})

test('re-importing a link already on the board is a duplicate without any fetch', async () => {
  await withBoard(async ({ request }) => {
    const pages = new Map([[IMPORT_PAGE_URL, previewPage({ title: 'Known', description: 'Known page.' })]])
    await withFakeFetch(pages, async (fetchImpl) => {
      const first = await request('POST', '/api/import', { urls: [IMPORT_PAGE_URL] })
      assert.equal(first.body.imported.length, 1)
      fetchImpl.calls.length = 0

      const again = await request('POST', '/api/import', { urls: [IMPORT_PAGE_URL] })
      assert.equal(again.status, 200)
      assert.equal(again.body.imported.length, 0)
      assert.deepEqual(again.body.duplicates.map((image) => image.id), [first.body.imported[0].id])
      assert.deepEqual(fetchImpl.calls, [], 'a known link is not fetched again')
    })
  })
})

test('the same image under a different URL is a duplicate by content', async () => {
  await withBoard(async ({ request }) => {
    const other = 'https://93.184.216.34/preview?utm_source=newsletter'
    const pages = new Map([
      [IMPORT_PAGE_URL, previewPage({ title: 'Original', description: 'First.' })],
      [other, previewPage({ title: 'Same image elsewhere', description: 'Second.' })],
    ])
    await withFakeFetch(pages, async () => {
      const first = await request('POST', '/api/import', { urls: [IMPORT_PAGE_URL] })
      assert.equal(first.body.imported.length, 1)
      const second = await request('POST', '/api/import', { urls: [other] })
      assert.equal(second.body.imported.length, 0)
      assert.deepEqual(second.body.duplicates.map((image) => image.id), [first.body.imported[0].id])

    })

    // Within one batch, the second page with the same image bytes is a duplicate too.
    const shared = 'https://93.184.216.34/hero-50.png'
    const batchPages = new Map([
      ['https://93.184.216.34/c', previewPage({ title: 'C', description: 'c', imageUrl: shared })],
      ['https://93.184.216.34/d', previewPage({ title: 'D', description: 'd', imageUrl: shared })],
    ])
    await withFakeFetch(batchPages, async () => {
      const batch = await request('POST', '/api/import', { urls: [...batchPages.keys()] })
      assert.equal(batch.body.imported.length, 1)
      assert.equal(batch.body.imported[0].name, 'C')
      assert.deepEqual(batch.body.duplicates.map((image) => image.id), [batch.body.imported[0].id])
      assert.equal((await request('GET', '/api/state')).body.board.images.length, 2)
    })
  })
})

// ---------------------------------------------------------------------------
// 0.4.3 — client store: local commits, idle polling, selection, uploads
// ---------------------------------------------------------------------------

/** A tiny in-memory host for client store tests (revision counts commits). */
function fakeHost(initialImages = []) {
  const host = {
    revision: 1,
    updatedAt: 'r1',
    images: initialImages.map((image) => ({ ...image })),
    calls: [],
    /** Simulate a write made by someone else (the agent, another window). */
    externalWrite() {
      host.revision += 1
      host.updatedAt = `r${host.revision}`
    },
  }
  const commit = () => {
    host.revision += 1
    host.updatedAt = `r${host.revision}`
    return { revision: host.revision, updatedAt: host.updatedAt }
  }
  host.fetch = async (url, init = {}) => {
    const path = String(url)
    const method = init.method ?? 'GET'
    host.calls.push(`${method} ${path}`)
    if (path.endsWith('/api/state')) {
      return jsonResponse({ ok: true, revision: host.revision, board: { version: 1, updatedAt: host.updatedAt, images: host.images } })
    }
    if (path.endsWith('/api/revision')) {
      return jsonResponse({ ok: true, revision: host.revision, updatedAt: host.updatedAt, images: host.images.length })
    }
    if (host.failNext) {
      host.failNext = false
      return { ok: false, status: 500, json: async () => ({ ok: false, error: { code: 'storage-failed', message: 'boom' } }) }
    }
    const body = init.body === undefined ? {} : JSON.parse(init.body)
    const match = /\/api\/images\/([^/]+)$/u.exec(path)
    if (method === 'PATCH' && match !== null) {
      const image = host.images.find((entry) => entry.id === match[1])
      Object.assign(image, body, { updatedAt: `u${host.revision + 1}` })
      return jsonResponse({ ok: true, image: { ...image }, ...commit() })
    }
    if (method === 'DELETE' && match !== null) {
      host.images = host.images.filter((entry) => entry.id !== match[1])
      return jsonResponse({ ok: true, removed: match[1], ...commit() })
    }
    if (method === 'POST' && path.endsWith('/api/images')) {
      const image = {
        id: `mb_${String(host.images.length + 1).padStart(12, '0')}`,
        name: body.name,
        tags: [],
        notes: '',
        sourceUrl: '',
        pinned: false,
        order: host.images.length,
        mediaType: body.mediaType,
        imageUrl: `/moodboard/image/x?v=${host.images.length}`,
        uploaded: body.data,
      }
      host.images.push(image)
      return jsonResponse({ ok: true, image: { ...image }, ...commit() })
    }
    if (method === 'POST' && path.endsWith('/api/images/reorder')) {
      body.ids.forEach((id, index) => {
        host.images.find((entry) => entry.id === id).order = index
      })
      return jsonResponse({ ok: true, ...commit() })
    }
    throw new Error(`unexpected ${method} ${path}`)
  }
  return host
}

const boardImage = (id, extra = {}) => ({
  id,
  name: `${id}.png`,
  tags: [],
  notes: '',
  sourceUrl: '',
  pinned: false,
  order: Number(id.slice(-1)),
  imageUrl: `/moodboard/image/${id}?v=1`,
  ...extra,
})

test('client mutations apply their own commit locally without re-reading the board', async () => {
  const host = fakeHost([boardImage('mb_00000000000a'), boardImage('mb_00000000000b')])
  const plugin = await loadClientModule(host.fetch)
  await plugin.refresh()
  host.calls.length = 0

  const saved = await plugin.patchImage('mb_00000000000a', { tags: ['Warm'] })
  assert.equal(saved.tags[0], 'Warm')
  assert.deepEqual(host.calls, ['PATCH /moodboard/api/images/mb_00000000000a'], 'no /api/state read')
  assert.deepEqual(Array.from(plugin.getSnapshot().board.allTags), ['Warm'])

  assert.equal(await plugin.removeImage(plugin.getSnapshot().board.images[1]), true)
  assert.equal(plugin.getSnapshot().board.images.length, 1)

  // Our own commits are adopted, so the next poll sees nothing new.
  host.calls.length = 0
  assert.equal(await plugin.pullBoardRevision(), false)
  assert.deepEqual(host.calls, ['GET /moodboard/api/revision'])
})

test('a commit that skips a revision (another write landed) reconciles with one silent read', async () => {
  const host = fakeHost([boardImage('mb_00000000000a')])
  const plugin = await loadClientModule(host.fetch)
  await plugin.refresh()
  host.externalWrite()
  host.images.push(boardImage('mb_00000000000c'))
  host.calls.length = 0

  await plugin.patchImage('mb_00000000000a', { notes: 'x' })
  assert.deepEqual(host.calls, ['PATCH /moodboard/api/images/mb_00000000000a', 'GET /moodboard/api/state'])
  assert.equal(plugin.getSnapshot().board.images.length, 2, 'the external image arrives too')
  assert.equal(plugin.getSnapshot().loading, false)
})

test('pinning flips at once and a failed pin restores the server state', async () => {
  const host = fakeHost([boardImage('mb_00000000000a')])
  const plugin = await loadClientModule(host.fetch)
  await plugin.refresh()
  const image = plugin.getSnapshot().board.images[0]

  const pending = plugin.setPinned(image, true)
  assert.equal(plugin.getSnapshot().board.images[0].pinned, true, 'optimistic before the response')
  assert.equal(await pending, true)
  assert.deepEqual(Array.from(plugin.getSnapshot().board.pinned), ['mb_00000000000a'])

  host.failNext = true
  assert.equal(await plugin.setPinned(plugin.getSnapshot().board.images[0], false), false)
  assert.equal(plugin.getSnapshot().board.images[0].pinned, true, 'the failed unpin is rolled back')
  assert.notEqual(plugin.getSnapshot().error, '')
})

test('reordering mirrors the new order locally', async () => {
  const host = fakeHost([boardImage('mb_00000000000a'), boardImage('mb_00000000000b')])
  const plugin = await loadClientModule(host.fetch)
  await plugin.refresh()
  host.calls.length = 0
  assert.equal(await plugin.reorderImages(['mb_00000000000b', 'mb_00000000000a']), true)
  assert.deepEqual(Array.from(plugin.getSnapshot().board.images, (image) => image.id), ['mb_00000000000b', 'mb_00000000000a'])
  assert.deepEqual(host.calls, ['POST /moodboard/api/images/reorder'])
})

test('unchanged images keep their object identity across refreshes', async () => {
  const host = fakeHost([boardImage('mb_00000000000a'), boardImage('mb_00000000000b')])
  const plugin = await loadClientModule(host.fetch)
  await plugin.refresh()
  const [first, second] = plugin.getSnapshot().board.images
  host.images[1].notes = 'changed'
  host.externalWrite()
  await plugin.refresh()
  const [nextFirst, nextSecond] = plugin.getSnapshot().board.images
  assert.equal(nextFirst, first, 'an untouched image is the same object (memoized cards skip it)')
  assert.notEqual(nextSecond, second)
  assert.equal(nextSecond.notes, 'changed')
})

test('with no page mounted the poll checks every 30 s; a mounted page polls every tick', async () => {
  const host = fakeHost()
  let clock = 1_000_000
  const intervals = []
  const context = {
    Date: { now: () => clock },
    document: eventTarget({ visibilityState: 'visible' }),
    setInterval: (callback, delay) => {
      intervals.push({ callback, delay })
      return { unref() {} }
    },
    clearInterval: () => {},
  }
  const plugin = await loadClientModule(host.fetch, context, eventTarget())
  await plugin.refresh()
  plugin.startBoardSync()
  const revisionReads = () => host.calls.filter((call) => call.endsWith('/api/revision')).length

  intervals[0].callback()
  await flushAsync()
  assert.equal(revisionReads(), 1)
  clock += 3000
  intervals[0].callback()
  await flushAsync()
  assert.equal(revisionReads(), 1, 'idle: a 3 s tick does not poll')
  clock += 30000
  intervals[0].callback()
  await flushAsync()
  assert.equal(revisionReads(), 2, 'idle: polls again after 30 s')

  const unmount = plugin.trackPageMount()
  clock += 3000
  intervals[0].callback()
  await flushAsync()
  assert.equal(revisionReads(), 3, 'mounted: every tick polls')
  unmount()
  unmount()
  clock += 3000
  intervals[0].callback()
  await flushAsync()
  assert.equal(revisionReads(), 3, 'unmounting twice does not go negative')
  plugin.stopBoardSync()
})

test('selection: single, toggle, range, select all, invert and clear', async () => {
  const ids = ['mb_00000000000a', 'mb_00000000000b', 'mb_00000000000c', 'mb_00000000000d']
  const host = fakeHost(ids.map((id) => boardImage(id)))
  const plugin = await loadClientModule(host.fetch)
  await plugin.refresh()
  const selected = () => Array.from(plugin.getSnapshot().selectedIds)

  plugin.selectSingleImage(ids[1])
  assert.deepEqual(selected(), [ids[1]])
  assert.equal(plugin.getSnapshot().selectedId, ids[1])
  plugin.toggleSelectedImage(ids[3])
  assert.deepEqual(selected(), [ids[1], ids[3]])
  plugin.toggleSelectedImage(ids[3])
  assert.deepEqual(selected(), [ids[1]])
  assert.equal(plugin.getSnapshot().selectionAnchorId, ids[3], 'a toggle moves the range anchor')
  plugin.selectSingleImage(ids[1])
  plugin.selectRangeTo(ids[3], ids)
  assert.deepEqual(selected(), [ids[1], ids[2], ids[3]])
  assert.equal(plugin.selectAllImages(ids), 4)
  assert.equal(plugin.getSnapshot().selectedId, null, 'select all closes the details panel')
  plugin.selectSingleImage(ids[0])
  assert.equal(plugin.invertSelectedImages(ids), 3)
  assert.deepEqual(selected(), [ids[1], ids[2], ids[3]])
  plugin.clearSelection()
  assert.deepEqual(selected(), [])
  assert.equal(plugin.getSnapshot().selectionAnchorId, null)
})

test('uploads keep small images as-is and add each file without a board read', async () => {
  const host = fakeHost()
  const context = {
    createImageBitmap: async () => ({ width: 800, height: 600, close() {} }),
    FileReader: class {
      readAsDataURL(blob) {
        this.result = `data:${blob.type};base64,${Buffer.from(blob.content).toString('base64')}`
        setImmediate(() => this.onload())
      }
    },
  }
  const plugin = await loadClientModule(host.fetch, context)
  await plugin.refresh()
  host.calls.length = 0
  const file = (name, type, content) => ({ name, type, size: content.length, content })
  await plugin.uploadFiles([file('shot.png', 'image/png', 'png-bytes'), file('anim.gif', 'image/gif', 'gif-bytes')])

  assert.deepEqual(host.calls, ['POST /moodboard/api/images', 'POST /moodboard/api/images'], 'no /api/state reads')
  assert.deepEqual(host.images.map((image) => image.mediaType), ['image/png', 'image/gif'], 'types are kept')
  assert.equal(Buffer.from(host.images[0].uploaded, 'base64').toString(), 'png-bytes', 'bytes are uploaded unchanged')
  assert.equal(plugin.getSnapshot().board.images.length, 2)
  assert.equal(plugin.getSnapshot().uploading, false)
})

test('the client injects its stylesheets once and the composer reads only the counts', async () => {
  const client = await read('client.js')
  assert.match(client, /injectStyle\('dsh-mb-page-css', PAGE_CSS\)/)
  assert.match(client, /injectStyle\('dsh-mb-reference-css', REFERENCE_CSS\)/)
  assert.doesNotMatch(client, /h\('style', null, PAGE_CSS\)/)
  assert.match(client, /removeInjectedStyles\(\)/)
  const button = client.slice(client.indexOf('function ReferenceButton'), client.indexOf('// Plugin entry'))
  assert.doesNotMatch(button, /useSyncExternalStore\(subscribe, getSnapshot\)/, 'the composer must not subscribe to the whole store')
})

test('the lightbox is its own component that owns focus, keys and its image URL', async () => {
  const client = await read('client.js')
  const start = client.indexOf('    function Lightbox(props) {')
  assert.ok(start !== -1, 'Lightbox component exists')
  const lightbox = client.slice(start, client.indexOf('    function MoodboardPage(props) {'))
  for (const anchor of ['useImageSource(image)', 'onError: onImageError', 'closeRef.current', 'LIGHTBOX_FOCUSABLE', "event.key === 'ArrowLeft'", "addEventListener('keydown'"]) {
    assert.ok(lightbox.includes(anchor), `Lightbox must own ${anchor}`)
  }
  const page = client.slice(client.indexOf('    function MoodboardPage(props) {'), client.indexOf('function ReferenceButton'))
  assert.match(page, /h\(Lightbox, \{/)
  assert.doesNotMatch(page, /renderLightbox|lightboxCloseRef|useImageUrl\(lightboxImage\)/)
})

test('the bulk bar is its own component that owns its tag input and delete confirmation', async () => {
  const client = await read('client.js')
  const start = client.indexOf('    function BulkBar(props) {')
  assert.ok(start !== -1, 'BulkBar component exists')
  const bar = client.slice(start, client.indexOf('    function MoodboardPage(props) {'))
  for (const anchor of ["useState('')", 'setBulkConfirmRemove', 'bulkUpdate(patch)', 'invertSelectedImages(visibleIds)', "role: 'toolbar'"]) {
    assert.ok(bar.includes(anchor), `BulkBar must own ${anchor}`)
  }
  const page = client.slice(client.indexOf('    function MoodboardPage(props) {'), client.indexOf('function ReferenceButton'))
  assert.match(page, /h\(BulkBar, \{/)
  assert.doesNotMatch(page, /renderBulkToolbar|setBulkTag|bulkConfirmRemove|runBulk/)
})

test('images load from their versioned URL and fall back to the blob path on error', async () => {
  const client = await read('client.js')
  const hook = client.slice(client.indexOf('    function useImageSource(image) {'), client.indexOf('    function Thumb(props) {'))
  assert.match(hook, /useBlob \? blobUrl : image\.imageUrl/, 'direct versioned URL first')
  assert.match(hook, /directLoadFailed\.add\(key\)/, 'a failed revision is remembered')
  assert.match(hook, /useImageUrl\(image, useBlob\)/, 'the blob loader only runs after a failure')
  const thumb = client.slice(client.indexOf('    function Thumb(props) {'), client.indexOf('    /** Scroll sentinel'))
  assert.match(thumb, /loading: lazy \? 'lazy' : 'eager'/)
  assert.match(thumb, /decoding: 'async'/)
  assert.match(thumb, /onError,/)
})
