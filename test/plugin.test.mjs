import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, rm, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { apply } from '../index.js'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'

const root = new URL('../', import.meta.url)
const read = (name) => readFile(new URL(name, root), 'utf8')

test('manifest declares the bundle, client half and runtime files', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.equal(pkg.name, '@stijnus/dsh-moodboard')
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
  assert.match(patch, /name: '@stijnus\/dsh-moodboard'/)
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
  assert.equal(loader[1], '@stijnus/dsh-moodboard')
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
