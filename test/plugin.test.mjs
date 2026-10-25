import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, rm, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { apply } from '../index.js'
import test from 'node:test'

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
    apply({
      effect: (fn) => fn(),
      webServer: { register: (route) => { handler = route.handler; return () => {} } },
      tools: { register: (value) => { tool = value; return () => {} } },
      systemPrompt: { section: () => () => {} },
      connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
      logger: { warn() {} },
      attachments: { saveImage: async ({ data, mediaType, name }) => ({ attachmentId: 'test-image', bytes: data.length, mediaType, name, width: 1, height: 1 }) },
    })
    const request = (method, path, body) => new Promise((resolve) => {
      const req = new EventEmitter()
      req.method = method; req.url = '/moodboard' + path
      req.headers = { 'content-type': 'application/json' }
      req.resume = () => {}
      let status
      handler(req, {
        writeHead: (value) => { status = value },
        end: (value) => resolve({ status, body: JSON.parse(value) }),
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
