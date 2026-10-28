import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, rm, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { apply } from '../index.js'
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
  assert.doesNotMatch(source, /from\s+['"](?!node:)/)
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
    apply({
      effect: (fn) => fn(),
      webServer: { register: (route) => { handler = route.handler; return () => {} } },
      tools: { register: (value) => { tool = value; return () => {} } },
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
    await run({ request, tool, root })
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
    "inject: ['slots', 'locale'], pullBoardRevision, getSnapshot, refresh, startBoardSync, stopBoardSync, applyBoard, setState,",
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
