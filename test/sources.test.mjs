/**
 * Unit tests for `sources.js` (inspiration intake adapters).
 *
 * Everything here runs offline: capture/discovery tests inject `fetchImpl`,
 * `lookupImpl`, and `endpoints`, so no real network call is made.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { copyFile, mkdir, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_DISCOVER_LIMIT,
  MAX_IMAGE_BYTES,
  MAX_IMPORT_PATHS,
  MAX_IMPORT_URLS,
  MAX_PAGE_BYTES,
  SOURCE_IDS,
  SourceError,
  captureReferences,
  detectImageMediaType,
  discoverReferences,
  extractPageMetadata,
  readReferenceFiles,
  readSourceConfig,
  sourceCatalog,
} from '../sources.js'

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

/** Real PNG fixture shipped with the plugin tests. */
const PNG_BYTES = new Uint8Array(
  await readFile(new URL('./fixtures/harness-light-reference.png', import.meta.url)),
)

const MINI_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)
const MINI_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
const MINI_GIF = new Uint8Array(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1'))
const MINI_WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])

/** Deterministic public DNS answer (93.184.216.34 = example.com). */
const lookupPublic = async () => [{ address: '93.184.216.34', family: 4 }]

/** Fetch stub routed by exact URL; records calls and parses no JSON itself. */
function makeFetch(routes) {
  const calls = []
  const impl = async (url, init = {}) => {
    const href = typeof url === 'string' ? url : String(url)
    calls.push({ url: href, init })
    const route = routes[href]
    if (route === undefined) throw new Error(`unexpected fetch: ${href}`)
    return typeof route === 'function' ? route(init) : route
  }
  impl.calls = calls
  return impl
}

/** Case-insensitive header lookup on recorded fetch init. */
function headerOf(init, name) {
  const headers = init?.headers ?? {}
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : headers[key]
}

function htmlResponse(html, status = 200, headers = {}) {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  })
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function imageResponse(bytes = MINI_PNG, mediaType = 'image/png', status = 200) {
  return new Response(bytes, { status, headers: { 'content-type': mediaType } })
}

/** Temporary directory removed when the test finishes. */
async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-moodboard-sources-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** Ensure `MOBBIN_API_KEY` is unset for the test, restoring it afterwards. */
function clearMobbinEnv(t) {
  const previous = process.env.MOBBIN_API_KEY
  delete process.env.MOBBIN_API_KEY
  t.after(() => {
    if (previous === undefined) delete process.env.MOBBIN_API_KEY
    else process.env.MOBBIN_API_KEY = previous
  })
}

/** Await a rejection whose `SourceError.code` equals `code`. */
async function assertRejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof SourceError, `expected SourceError, got ${error}`)
    assert.equal(error.code, code)
    return true
  })
}

// ---------------------------------------------------------------------------
// Module surface
// ---------------------------------------------------------------------------

test('exports the contract constants and API surface', () => {
  assert.deepEqual(SOURCE_IDS, ['web', 'mobbin', 'arena'])
  assert.equal(MAX_IMPORT_URLS, 20)
  assert.equal(MAX_IMPORT_PATHS, 20)
  assert.equal(MAX_DISCOVER_LIMIT, 12)
  assert.equal(MAX_PAGE_BYTES, 4 * 1024 * 1024)
  assert.equal(MAX_IMAGE_BYTES, 12 * 1024 * 1024)

  assert.equal(typeof SourceError, 'function')
  assert.ok(new SourceError('invalid-url', 'nope') instanceof Error)
  assert.equal(new SourceError('invalid-url', 'nope').code, 'invalid-url')
  for (const fn of [
    readSourceConfig,
    sourceCatalog,
    detectImageMediaType,
    extractPageMetadata,
    captureReferences,
    discoverReferences,
    readReferenceFiles,
  ]) {
    assert.equal(typeof fn, 'function')
  }
})

test('source file is plain ESM with node: builtins only', async () => {
  const source = await readFile(new URL('../sources.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /from\s+['"](?!node:)/u)
  assert.doesNotMatch(source, /require\s*\(/u)
  assert.doesNotMatch(source, /console\./u)
})

test('importing the module performs no network calls', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = () => {
    calls += 1
    throw new Error('network access at import time')
  }
  try {
    const fresh = await import(`../sources.js?network=${Date.now()}`)
    assert.equal(typeof fresh.captureReferences, 'function')
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = original
  }
})

// ---------------------------------------------------------------------------
// detectImageMediaType
// ---------------------------------------------------------------------------

test('detects PNG, JPEG, GIF and WebP signatures', () => {
  assert.equal(detectImageMediaType(PNG_BYTES), 'image/png')
  assert.equal(detectImageMediaType(MINI_PNG), 'image/png')
  assert.equal(detectImageMediaType(MINI_JPEG), 'image/jpeg')
  assert.equal(detectImageMediaType(MINI_GIF), 'image/gif')
  assert.equal(detectImageMediaType(MINI_WEBP), 'image/webp')
  assert.equal(detectImageMediaType(PNG_BYTES.buffer.slice(0, PNG_BYTES.byteLength)), 'image/png')
})

test('rejects unknown, empty and truncated image data', () => {
  assert.equal(detectImageMediaType(new Uint8Array()), '')
  assert.equal(detectImageMediaType(new TextEncoder().encode('<html></html>')), '')
  assert.equal(detectImageMediaType(PNG_BYTES.subarray(0, 4)), '')
  assert.equal(detectImageMediaType(MINI_JPEG.subarray(0, 2)), '')
  assert.equal(detectImageMediaType(null), '')
  assert.equal(detectImageMediaType('not bytes'), '')
})

// ---------------------------------------------------------------------------
// extractPageMetadata
// ---------------------------------------------------------------------------

test('extracts Open Graph metadata, decodes entities and resolves relative URLs', () => {
  const html = `<!doctype html><html><head>
    <title>Fallback &amp; Title</title>
    <meta property="og:title" content="Acme &amp; Co — Dashboard">
    <meta property="og:description" content="A calmer dashboard &amp; better hierarchy.">
    <meta name="author" content="Ada Lovelace">
    <meta property="og:site_name" content="Acme">
    <meta property="og:image" content="/media/og-image.png">
    <link rel="canonical" href="../canonical">
  </head></html>`
  const meta = extractPageMetadata(html, 'https://example.com/blog/post')
  assert.equal(meta.title, 'Acme & Co — Dashboard')
  assert.equal(meta.description, 'A calmer dashboard & better hierarchy.')
  assert.equal(meta.author, 'Ada Lovelace')
  assert.equal(meta.site, 'Acme')
  assert.equal(meta.canonical, 'https://example.com/canonical')
  assert.equal(meta.imageUrl, 'https://example.com/media/og-image.png')
  assert.deepEqual(meta.imageCandidates, ['https://example.com/media/og-image.png'])
})

test('applies the contract title, description, author and site fallbacks', () => {
  const base = 'https://example.com/page'
  assert.equal(extractPageMetadata('<title>Only &amp; Title</title>', base).title, 'Only & Title')
  assert.equal(
    extractPageMetadata('<meta name="twitter:title" content="Twitter Title">', base).title,
    'Twitter Title',
  )
  assert.equal(
    extractPageMetadata('<meta property="og:site_name" content="Site Only">', base).title,
    'Site Only',
  )
  assert.equal(extractPageMetadata('<html></html>', base).title, 'example.com')
  assert.equal(
    extractPageMetadata('<title>Tag</title><meta property="og:title" content="OG">', base).title,
    'OG',
  )
  assert.equal(
    extractPageMetadata('<meta property="og:title" content="OG &gt; all">', base).title,
    'OG > all',
  )

  assert.equal(
    extractPageMetadata('<meta name="description" content="Plain description">', base).description,
    'Plain description',
  )
  assert.equal(
    extractPageMetadata('<meta name="twitter:description" content="Tweet description">', base).description,
    'Tweet description',
  )
  assert.equal(
    extractPageMetadata('<meta property="og:description" content="OG description">', base).description,
    'OG description',
  )

  assert.equal(
    extractPageMetadata('<meta property="article:author" content="Article Author">', base).author,
    'Article Author',
  )
  assert.equal(
    extractPageMetadata('<meta name="twitter:creator" content="@ada">', base).author,
    '@ada',
  )
  assert.equal(extractPageMetadata('<meta name="author" content="Plain Author">', base).author, 'Plain Author')
  assert.equal(extractPageMetadata('<html></html>', base).site, 'example.com')
})

test('orders image candidates by the contract priority', () => {
  const html = `
    <meta property="og:image" content="https://cdn.example.com/a.png">
    <meta property="og:image:url" content="https://cdn.example.com/b.png">
    <meta name="twitter:image" content="/c.png">
    <meta name="twitter:image:src" content="/d.png">
    <link rel="image_src" href="/e.png">
    <meta itemprop="image" content="/f.png">
    <img src="data:image/png;base64,AAAA">
    <img src="/second.png">`
  const meta = extractPageMetadata(html, 'https://example.com/page')
  assert.equal(meta.imageUrl, 'https://cdn.example.com/a.png')
  assert.deepEqual(meta.imageCandidates, [
    'https://cdn.example.com/a.png',
    'https://cdn.example.com/b.png',
    'https://example.com/c.png',
    'https://example.com/d.png',
    'https://example.com/e.png',
    'https://example.com/f.png',
    'https://example.com/second.png',
  ])
})

test('falls back to the first resolvable img and ignores unsafe candidates', () => {
  const relative = extractPageMetadata('<img src="media/pic.png">', 'https://example.com/blog/post/')
  assert.equal(relative.imageUrl, 'https://example.com/blog/post/media/pic.png')

  const unsafe = extractPageMetadata(
    '<link rel="canonical" href="javascript:alert(1)"><img src="data:image/gif;base64,AA">',
    'https://example.com/x',
  )
  assert.equal(unsafe.canonical, '')
  assert.equal(unsafe.imageUrl, '')
  assert.deepEqual(unsafe.imageCandidates, [])
})

test('is pure and tolerates non-string input', () => {
  const meta = extractPageMetadata(null, null)
  assert.deepEqual(meta, {
    title: '',
    description: '',
    author: '',
    site: '',
    canonical: '',
    imageUrl: '',
    imageCandidates: [],
  })
})

// ---------------------------------------------------------------------------
// captureReferences: happy paths
// ---------------------------------------------------------------------------

test('captures a page through Open Graph metadata and its preview image', async () => {
  const pageHtml = `<!doctype html><html><head>
    <title>Fallback title</title>
    <meta property="og:title" content="Acme &amp; Co Dashboard">
    <meta property="og:description" content="A calmer dashboard.">
    <meta name="author" content="Ada Lovelace">
    <meta property="og:site_name" content="Acme">
    <meta property="og:image" content="/media/og-image.png">
    <link rel="canonical" href="/canonical-article">
  </head></html>`
  const fetchImpl = makeFetch({
    'https://example.com/article': htmlResponse(pageHtml),
    'https://example.com/media/og-image.png': imageResponse(PNG_BYTES),
  })

  const { drafts, failures } = await captureReferences(['https://example.com/article'], {
    fetchImpl,
    lookupImpl: lookupPublic,
  })

  assert.deepEqual(failures, [])
  assert.equal(drafts.length, 1)
  const draft = drafts[0]
  assert.equal(draft.origin, 'web')
  assert.equal(draft.mediaType, 'image/png')
  assert.deepEqual(draft.tags, ['web', 'example.com'])
  assert.equal(draft.name, 'Acme & Co Dashboard')
  assert.equal(
    draft.notes,
    'Captured from Acme (example.com) — Acme & Co Dashboard by Ada Lovelace. A calmer dashboard.',
  )
  assert.equal(draft.sourceUrl, 'https://example.com/canonical-article')
  assert.deepEqual(draft.bytes, PNG_BYTES)

  assert.equal(fetchImpl.calls.length, 2)
  assert.equal(fetchImpl.calls[1].url, 'https://example.com/media/og-image.png')
  for (const call of fetchImpl.calls) {
    assert.match(headerOf(call.init, 'user-agent'), /dsh-moodboard\/0\.3/u)
    assert.equal(headerOf(call.init, 'authorization'), undefined)
    assert.equal(headerOf(call.init, 'cookie'), undefined)
    assert.equal(call.init.redirect, 'manual')
  }
})

test('captures a direct image URL with a name from the URL path', async () => {
  const fetchImpl = makeFetch({
    'https://cdn.example.com/shots/hero.png': imageResponse(PNG_BYTES),
  })
  const { drafts, failures } = await captureReferences(['https://cdn.example.com/shots/hero.png'], {
    fetchImpl,
    lookupImpl: lookupPublic,
  })
  assert.deepEqual(failures, [])
  assert.equal(drafts.length, 1)
  const draft = drafts[0]
  assert.equal(draft.name, 'hero.png')
  assert.equal(draft.notes, 'Image from cdn.example.com.')
  assert.deepEqual(draft.tags, ['web', 'cdn.example.com'])
  assert.equal(draft.sourceUrl, 'https://cdn.example.com/shots/hero.png')
  assert.equal(draft.origin, 'web')
  assert.equal(draft.mediaType, 'image/png')
})

test('trusts the image signature over a wrong content type', async () => {
  const fetchImpl = makeFetch({
    'https://cdn.example.com/photo': imageResponse(MINI_JPEG, 'image/png'),
  })
  const { drafts, failures } = await captureReferences(['https://cdn.example.com/photo'], {
    fetchImpl,
    lookupImpl: lookupPublic,
  })
  assert.deepEqual(failures, [])
  assert.equal(drafts[0].mediaType, 'image/jpeg')
})

test('dedupes an exact duplicate URL within the batch', async () => {
  const fetchImpl = makeFetch({
    'https://example.com/one': htmlResponse(
      '<meta property="og:image" content="https://example.com/one.png">',
    ),
    'https://example.com/one.png': imageResponse(MINI_PNG),
  })
  const { drafts, failures } = await captureReferences(
    ['https://example.com/one', 'https://example.com/one'],
    { fetchImpl, lookupImpl: lookupPublic },
  )
  assert.deepEqual(failures, [])
  assert.equal(drafts.length, 1)
  assert.equal(fetchImpl.calls.length, 2)
})

// ---------------------------------------------------------------------------
// captureReferences: failures
// ---------------------------------------------------------------------------

test('maps a Dribbble bot challenge to blocked-source with guidance', async () => {
  const fetchImpl = makeFetch({
    'https://dribbble.com/shots/123': new Response('', {
      status: 202,
      headers: { 'content-type': 'text/html' },
    }),
  })
  const { drafts, failures } = await captureReferences(['https://dribbble.com/shots/123'], {
    fetchImpl,
    lookupImpl: lookupPublic,
  })
  assert.deepEqual(drafts, [])
  assert.equal(failures.length, 1)
  assert.equal(failures[0].code, 'blocked-source')
  assert.match(failures[0].message, /browser MCP|upload a screenshot/iu)
  assert.equal(fetchImpl.calls.length, 1)
})

test('reports no-preview-image when a page has no image', async () => {
  const fetchImpl = makeFetch({
    'https://example.com/text': htmlResponse('<html><head><title>Just text</title></head></html>'),
  })
  const { drafts, failures } = await captureReferences(['https://example.com/text'], {
    fetchImpl,
    lookupImpl: lookupPublic,
  })
  assert.deepEqual(drafts, [])
  assert.equal(failures[0].code, 'no-preview-image')
  assert.match(failures[0].message, /upload a screenshot/iu)
  assert.equal(fetchImpl.calls.length, 1)
})

test('rejects unsupported, invalid and non-page responses', async () => {
  const fetchImpl = makeFetch({
    'https://cdn.example.com/icon.svg': new Response('<svg/>', {
      status: 200,
      headers: { 'content-type': 'image/svg+xml' },
    }),
    'https://cdn.example.com/broken.png': imageResponse(new TextEncoder().encode('not an image'), 'image/png'),
    'https://example.com/api.json': new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    'https://example.com/missing': new Response('nope', {
      status: 500,
      headers: { 'content-type': 'text/html' },
    }),
  })
  const { drafts, failures } = await captureReferences(
    [
      'https://cdn.example.com/icon.svg',
      'https://cdn.example.com/broken.png',
      'https://example.com/api.json',
      'https://example.com/missing',
    ],
    { fetchImpl, lookupImpl: lookupPublic },
  )
  assert.deepEqual(drafts, [])
  assert.deepEqual(
    failures.map((failure) => failure.code),
    ['unsupported-media-type', 'invalid-image', 'unsupported-url', 'upstream-error'],
  )
  assert.equal(fetchImpl.calls.length, 4)
})

test('enforces the page and image read caps', async () => {
  const fetchImpl = makeFetch({
    'https://cdn.example.com/huge.png': new Response(new Uint8Array(1), {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) },
    }),
    'https://example.com/huge': new Response('<html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html', 'content-length': String(MAX_PAGE_BYTES + 1) },
    }),
  })
  const { drafts, failures } = await captureReferences(
    ['https://cdn.example.com/huge.png', 'https://example.com/huge'],
    { fetchImpl, lookupImpl: lookupPublic },
  )
  assert.deepEqual(drafts, [])
  assert.deepEqual(
    failures.map((failure) => failure.code),
    ['image-too-large', 'upstream-error'],
  )
})

test('uses the image cap for a direct image served with a generic content type', async () => {
  const bigPng = new Uint8Array(5 * 1024 * 1024)
  bigPng.set(MINI_PNG)
  const bigHtml = new TextEncoder().encode(`<html>${'x'.repeat(5 * 1024 * 1024)}</html>`)
  const fetchImpl = makeFetch({
    'https://cdn.example.com/generic': new Response(bigPng, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    }),
    'https://example.com/oversize-page': new Response(bigHtml, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  })
  const { drafts, failures } = await captureReferences(
    ['https://cdn.example.com/generic', 'https://example.com/oversize-page'],
    { fetchImpl, lookupImpl: lookupPublic },
  )
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0].mediaType, 'image/png')
  assert.equal(drafts[0].bytes.byteLength, bigPng.byteLength)
  assert.equal(failures.length, 1)
  assert.equal(failures[0].code, 'upstream-error')
  assert.match(failures[0].message, /too large/iu)
})

test('rejects private, reserved and malformed URLs without fetching', async () => {
  const cases = [
    ['not a url', 'invalid-url'],
    ['ftp://example.com/x', 'unsupported-url'],
    [`https://example.com/${'a'.repeat(2001)}`, 'invalid-url'],
    ['https://user:pass@example.com/', 'invalid-url'],
    ['http://localhost/x', 'unsupported-url'],
    ['http://foo.localhost/x', 'unsupported-url'],
    ['http://printer.local/x', 'unsupported-url'],
    ['http://intranet.internal/x', 'unsupported-url'],
    ['http://127.0.0.1/x', 'unsupported-url'],
    ['http://10.1.2.3/x', 'unsupported-url'],
    ['http://172.16.5.4/x', 'unsupported-url'],
    ['http://192.168.1.1/x', 'unsupported-url'],
    ['http://169.254.1.1/x', 'unsupported-url'],
    ['http://100.64.0.1/x', 'unsupported-url'],
    ['http://0.0.0.0/x', 'unsupported-url'],
    ['http://[::1]/x', 'unsupported-url'],
    ['http://[fc00::1]/x', 'unsupported-url'],
    ['http://[fe80::1]/x', 'unsupported-url'],
    ['http://[::ffff:127.0.0.1]/x', 'unsupported-url'],
  ]
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    throw new Error('fetch must not run')
  }
  const { drafts, failures } = await captureReferences(
    cases.map(([input]) => input),
    { fetchImpl, lookupImpl: lookupPublic },
  )
  assert.equal(calls, 0)
  assert.deepEqual(drafts, [])
  assert.equal(failures.length, cases.length)
  cases.forEach(([input, code], index) => {
    assert.equal(failures[index].input, input)
    assert.equal(failures[index].code, code, `expected ${code} for ${input}`)
  })
})

test('rejects IPv6 transition and reserved ranges that embed private IPv4', async () => {
  const cases = [
    ['http://[64:ff9b::7f00:1]/x', 'unsupported-url'],
    ['http://[64:ff9b::a9fe:a9fe]/x', 'unsupported-url'],
    ['http://[64:ff9b:1::1]/x', 'unsupported-url'],
    ['http://[2002:a9fe:a9fe::1]/x', 'unsupported-url'],
    ['http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/x', 'unsupported-url'],
    ['http://[2001:db8::1]/x', 'unsupported-url'],
    ['http://[100::1]/x', 'unsupported-url'],
  ]
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    throw new Error('fetch must not run')
  }
  const { drafts, failures } = await captureReferences(
    cases.map(([input]) => input),
    { fetchImpl, lookupImpl: lookupPublic },
  )
  assert.equal(calls, 0)
  assert.deepEqual(drafts, [])
  assert.deepEqual(
    failures.map((failure) => failure.code),
    cases.map(([, code]) => code),
  )
})

test('rejects hostnames that resolve to private addresses or fail DNS', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    throw new Error('fetch must not run')
  }

  const privateLookup = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.5', family: 4 },
  ]
  const mixed = await captureReferences(['https://evil.example/x'], {
    fetchImpl,
    lookupImpl: privateLookup,
  })
  assert.equal(calls, 0)
  assert.equal(mixed.failures[0].code, 'unsupported-url')

  const failingLookup = async () => {
    throw Object.assign(new Error('no such host'), { code: 'ENOTFOUND' })
  }
  const failed = await captureReferences(['https://missing.example/x'], {
    fetchImpl,
    lookupImpl: failingLookup,
  })
  assert.equal(calls, 0)
  assert.equal(failed.failures[0].code, 'upstream-error')
})

test('follows relative redirects and reports the final URL', async () => {
  const fetchImpl = makeFetch({
    'https://example.com/old': new Response(null, {
      status: 302,
      headers: { location: '/new' },
    }),
    'https://example.com/new': htmlResponse(
      '<meta property="og:title" content="Moved"><meta property="og:image" content="/img.png">',
    ),
    'https://example.com/img.png': imageResponse(MINI_PNG),
  })
  const { drafts, failures } = await captureReferences(['https://example.com/old'], {
    fetchImpl,
    lookupImpl: lookupPublic,
  })
  assert.deepEqual(failures, [])
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0].sourceUrl, 'https://example.com/new')
  assert.equal(drafts[0].name, 'Moved')
  assert.equal(fetchImpl.calls.length, 3)
})

test('re-validates redirect hops against private addresses', async () => {
  const fetchImpl = makeFetch({
    'https://example.com/redir': new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/admin' },
    }),
  })
  const { drafts, failures } = await captureReferences(['https://example.com/redir'], {
    fetchImpl,
    lookupImpl: lookupPublic,
  })
  assert.deepEqual(drafts, [])
  assert.equal(failures[0].code, 'unsupported-url')
  assert.equal(fetchImpl.calls.length, 1)
})

test('limits redirect chains and rejects redirects without a destination', async () => {
  const chainFetch = makeFetch({
    'https://example.com/0': new Response(null, { status: 302, headers: { location: '/1' } }),
    'https://example.com/1': new Response(null, { status: 302, headers: { location: '/2' } }),
    'https://example.com/2': new Response(null, { status: 302, headers: { location: '/3' } }),
    'https://example.com/3': new Response(null, { status: 302, headers: { location: '/4' } }),
  })
  const chained = await captureReferences(['https://example.com/0'], {
    fetchImpl: chainFetch,
    lookupImpl: lookupPublic,
  })
  assert.equal(chained.failures[0].code, 'upstream-error')
  assert.match(chained.failures[0].message, /redirect/iu)
  assert.equal(chainFetch.calls.length, 4)

  const missingFetch = makeFetch({
    'https://example.com/empty': new Response(null, { status: 302 }),
  })
  const missing = await captureReferences(['https://example.com/empty'], {
    fetchImpl: missingFetch,
    lookupImpl: lookupPublic,
  })
  assert.equal(missing.failures[0].code, 'upstream-error')
})

test('times out slow requests with upstream-error', async () => {
  const fetchImpl = (url, init) =>
    new Promise((resolve, reject) => {
      const signal = init?.signal
      if (signal?.aborted === true) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })
  const { drafts, failures } = await captureReferences(['https://example.com/slow'], {
    fetchImpl,
    lookupImpl: lookupPublic,
    timeoutMs: 25,
  })
  assert.deepEqual(drafts, [])
  assert.equal(failures[0].code, 'upstream-error')
  assert.match(failures[0].message, /timed out/iu)
})

test('validates the capture batch shape and per-item input', async () => {
  await assertRejectsWithCode(captureReferences([], {}), 'invalid-url')
  await assertRejectsWithCode(
    captureReferences(
      Array.from({ length: MAX_IMPORT_URLS + 1 }, (_, index) => `https://example.com/${index}`),
      {},
    ),
    'invalid-url',
  )
  await assertRejectsWithCode(captureReferences('https://example.com/x', {}), 'invalid-url')

  const fetchImpl = async () => {
    throw new Error('fetch must not run')
  }
  const { drafts, failures } = await captureReferences([42, ''], {
    fetchImpl,
    lookupImpl: lookupPublic,
  })
  assert.deepEqual(drafts, [])
  assert.deepEqual(
    failures.map((failure) => failure.code),
    ['invalid-url', 'invalid-url'],
  )
})

// ---------------------------------------------------------------------------
// discoverReferences: Mobbin
// ---------------------------------------------------------------------------

const MOBBIN_ENDPOINT = 'https://api.mobbin.test/v1/screens/search'

function mobbinOptions(fetchImpl, extra = {}) {
  return {
    config: { mobbinApiKey: 'test-key' },
    fetchImpl,
    lookupImpl: lookupPublic,
    endpoints: { mobbinSearch: MOBBIN_ENDPOINT },
    ...extra,
  }
}

test('searches Mobbin and drafts each screen with provenance', async () => {
  const fetchImpl = makeFetch({
    [MOBBIN_ENDPOINT]: (init) => {
      const body = JSON.parse(init.body)
      assert.deepEqual(body, {
        query: 'checkout paywall',
        platform: 'ios',
        mode: 'standard',
        limit: 2,
      })
      assert.equal(headerOf(init, 'authorization'), 'Bearer test-key')
      assert.equal(headerOf(init, 'content-type'), 'application/json')
      return jsonResponse({
        screens: [
          {
            id: 'a1',
            app_name: 'Acme Bank',
            platform: 'ios',
            mobbin_url: 'https://mobbin.com/screens/a1',
            image: { url: 'https://cdn.mobbin.test/a1.png', width: 390, height: 844 },
          },
          {
            id: 'a2',
            app_name: 'Other App',
            platform: 'ios',
            mobbin_url: 'https://mobbin.com/screens/a2',
            image_url: 'https://cdn.mobbin.test/a2.jpg',
          },
        ],
      })
    },
    'https://cdn.mobbin.test/a1.png': imageResponse(PNG_BYTES),
    'https://cdn.mobbin.test/a2.jpg': imageResponse(MINI_JPEG, 'image/jpeg'),
  })

  const { drafts, failures } = await discoverReferences(
    { source: 'mobbin', query: 'checkout paywall', platform: 'ios', limit: 2 },
    mobbinOptions(fetchImpl),
  )
  assert.deepEqual(failures, [])
  assert.equal(drafts.length, 2)

  const [first, second] = drafts
  assert.equal(first.origin, 'mobbin')
  assert.equal(first.name, 'Acme Bank — checkout paywall')
  assert.deepEqual(first.tags, ['mobbin', 'ios', 'Acme Bank'])
  assert.equal(first.sourceUrl, 'https://mobbin.com/screens/a1')
  assert.equal(first.mediaType, 'image/png')
  assert.match(first.notes, /Mobbin/u)
  assert.match(first.notes, /Acme Bank/u)
  assert.match(first.notes, /ios/u)
  assert.match(first.notes, /checkout paywall/u)
  assert.match(first.notes, /https:\/\/mobbin\.com\/screens\/a1/u)

  assert.equal(second.name, 'Other App — checkout paywall')
  assert.equal(second.mediaType, 'image/jpeg')

  // The bearer key is only sent to the API endpoint, never to image hosts.
  assert.equal(headerOf(fetchImpl.calls[0].init, 'authorization'), 'Bearer test-key')
  for (const call of fetchImpl.calls.slice(1)) {
    assert.equal(headerOf(call.init, 'authorization'), undefined)
    assert.equal(headerOf(call.init, 'cookie'), undefined)
  }
})

test('one failed Mobbin image does not abort the batch', async () => {
  const fetchImpl = makeFetch({
    [MOBBIN_ENDPOINT]: () =>
      jsonResponse({
        screens: [
          {
            id: 'ok',
            app_name: 'Good App',
            mobbin_url: 'https://mobbin.com/screens/ok',
            image: { url: 'https://cdn.mobbin.test/ok.png' },
          },
          {
            id: 'bad',
            app_name: 'Bad App',
            mobbin_url: 'https://mobbin.com/screens/bad',
            image: { url: 'https://cdn.mobbin.test/bad.png' },
          },
          { id: 'empty', app_name: 'No Image', mobbin_url: 'https://mobbin.com/screens/empty' },
        ],
      }),
    'https://cdn.mobbin.test/ok.png': imageResponse(MINI_PNG),
    'https://cdn.mobbin.test/bad.png': new Response('gone', { status: 404 }),
  })

  const { drafts, failures } = await discoverReferences(
    { source: 'mobbin', query: 'checkout', limit: 3 },
    mobbinOptions(fetchImpl),
  )
  assert.equal(drafts.length, 1)
  assert.equal(failures.length, 2)
  assert.equal(failures[0].code, 'upstream-error')
  assert.equal(failures[0].input, 'https://mobbin.com/screens/bad')
  assert.equal(failures[1].code, 'no-preview-image')
  assert.equal(failures[1].input, 'https://mobbin.com/screens/empty')
})

test('maps Mobbin 401, 403 and 500 responses', async () => {
  for (const [status, code] of [
    [401, 'source-unauthorized'],
    [403, 'source-plan-required'],
    [500, 'upstream-error'],
  ]) {
    const fetchImpl = makeFetch({
      [MOBBIN_ENDPOINT]: () => new Response('{}', { status, headers: { 'content-type': 'application/json' } }),
    })
    await assertRejectsWithCode(
      discoverReferences({ source: 'mobbin', query: 'x' }, mobbinOptions(fetchImpl)),
      code,
    )
  }
})

test('maps Mobbin 429 and respects Retry-After', async () => {
  const fetchImpl = makeFetch({
    [MOBBIN_ENDPOINT]: () =>
      new Response('{}', {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '30' },
      }),
  })
  let caught
  try {
    await discoverReferences({ source: 'mobbin', query: 'x' }, mobbinOptions(fetchImpl))
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof SourceError)
  assert.equal(caught.code, 'rate-limited')
  assert.equal(caught.retryAfter, 30)
  assert.match(caught.message, /30s/u)
})

test('requires a Mobbin key, including an environment fallback', async (t) => {
  clearMobbinEnv(t)
  const noFetch = async () => {
    throw new Error('fetch must not run without a key')
  }
  await assertRejectsWithCode(
    discoverReferences(
      { source: 'mobbin', query: 'x' },
      { config: { mobbinApiKey: null }, fetchImpl: noFetch, lookupImpl: lookupPublic },
    ),
    'source-unavailable',
  )
  await assertRejectsWithCode(
    discoverReferences(
      { source: 'mobbin', query: 'x' },
      { fetchImpl: noFetch, lookupImpl: lookupPublic },
    ),
    'source-unavailable',
  )

  // Environment key is used when the caller does not pass a config object.
  process.env.MOBBIN_API_KEY = 'env-key'
  const fetchImpl = makeFetch({
    [MOBBIN_ENDPOINT]: (init) => {
      assert.equal(headerOf(init, 'authorization'), 'Bearer env-key')
      return jsonResponse({ screens: [] })
    },
  })
  const result = await discoverReferences(
    { source: 'mobbin', query: 'x' },
    { fetchImpl, lookupImpl: lookupPublic, endpoints: { mobbinSearch: MOBBIN_ENDPOINT } },
  )
  assert.deepEqual(result, { drafts: [], failures: [] })
})

test('validates Mobbin discover input before fetching', async () => {
  const noFetch = async () => {
    throw new Error('fetch must not run')
  }
  const options = mobbinOptions(noFetch)
  await assertRejectsWithCode(discoverReferences({ source: 'dribbble', query: 'x' }, options), 'invalid-argument')
  await assertRejectsWithCode(discoverReferences({ source: 'web', query: 'x' }, options), 'invalid-argument')
  await assertRejectsWithCode(discoverReferences({ source: 'mobbin', query: '' }, options), 'invalid-argument')
  await assertRejectsWithCode(
    discoverReferences({ source: 'mobbin', query: 'x'.repeat(501) }, options),
    'invalid-argument',
  )
  await assertRejectsWithCode(
    discoverReferences({ source: 'mobbin', query: 'x', limit: 0 }, options),
    'invalid-argument',
  )
  await assertRejectsWithCode(
    discoverReferences({ source: 'mobbin', query: 'x', limit: MAX_DISCOVER_LIMIT + 1 }, options),
    'invalid-argument',
  )
  await assertRejectsWithCode(
    discoverReferences({ source: 'mobbin', query: 'x', platform: 'android' }, options),
    'invalid-argument',
  )
  await assertRejectsWithCode(discoverReferences(null, options), 'invalid-argument')
})

test('rejects malformed Mobbin responses', async () => {
  const malformed = makeFetch({
    [MOBBIN_ENDPOINT]: () =>
      new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }),
  })
  await assertRejectsWithCode(
    discoverReferences({ source: 'mobbin', query: 'x' }, mobbinOptions(malformed)),
    'upstream-error',
  )

  const unexpected = makeFetch({
    [MOBBIN_ENDPOINT]: () => jsonResponse({ items: [] }),
  })
  await assertRejectsWithCode(
    discoverReferences({ source: 'mobbin', query: 'x' }, mobbinOptions(unexpected)),
    'upstream-error',
  )
})

// ---------------------------------------------------------------------------
// discoverReferences: Are.na
// ---------------------------------------------------------------------------

const ARENA_ENDPOINT = 'https://api.are.na/v2/search'

test('searches Are.na publicly and parses blocks', async () => {
  const expectedUrl = `${ARENA_ENDPOINT}?q=checkout+paywall&per=20`
  const fetchImpl = makeFetch({
    [expectedUrl]: (init) => {
      assert.equal(init.method, 'GET')
      assert.equal(headerOf(init, 'authorization'), undefined)
      assert.equal(headerOf(init, 'cookie'), undefined)
      // Are.na blocks a browser UA as unidentified automation; API calls use
      // the honest plugin UA and never pretend to be Chrome.
      assert.match(headerOf(init, 'user-agent') ?? '', /^dsh-moodboard\/0\.3/u)
      assert.doesNotMatch(headerOf(init, 'user-agent') ?? '', /Mozilla/u)
      return jsonResponse({
        blocks: [
          {
            id: 11,
            title: 'Dashboard layout',
            source: { url: 'https://example.com/insp', title: 'Source title' },
            image: {
              large: { url: 'https://cdn.arena.test/large.png' },
              display: { url: 'https://cdn.arena.test/display.png' },
              original: { url: 'https://cdn.arena.test/original.png' },
            },
          },
          { id: 12, title: 'Just text', image: null },
          { id: 13, image: { display: { url: 'https://cdn.arena.test/fallback.png' } } },
        ],
      })
    },
    'https://cdn.arena.test/large.png': imageResponse(MINI_PNG),
    'https://cdn.arena.test/fallback.png': imageResponse(MINI_JPEG, 'image/jpeg'),
  })

  const { drafts, failures } = await discoverReferences(
    { source: 'arena', query: 'checkout paywall', limit: 3 },
    {
      fetchImpl,
      lookupImpl: lookupPublic,
      endpoints: { arenaSearch: ARENA_ENDPOINT },
    },
  )

  assert.equal(drafts.length, 2)
  // The text block is skipped, not counted against the limit or reported as a
  // failure.
  assert.equal(failures.length, 0)

  const [first, second] = drafts
  assert.equal(first.origin, 'arena')
  assert.equal(first.name, 'Dashboard layout')
  assert.deepEqual(first.tags, ['arena'])
  assert.equal(first.sourceUrl, 'https://example.com/insp')
  assert.equal(first.mediaType, 'image/png')
  assert.match(first.notes, /Are\.na/u)
  assert.match(first.notes, /11/u)
  assert.match(first.notes, /Dashboard layout/u)
  assert.match(first.notes, /https:\/\/example\.com\/insp/u)

  assert.equal(second.name, 'Are.na reference')
  assert.equal(second.sourceUrl, 'https://www.are.na/block/13')
  assert.equal(second.mediaType, 'image/jpeg')
  assert.match(second.notes, /Are\.na block 13/u)

  for (const call of fetchImpl.calls) assert.equal(headerOf(call.init, 'authorization'), undefined)
})

test('does not let Are.na text blocks consume the image-block limit', async () => {
  const fetchImpl = makeFetch({
    [`${ARENA_ENDPOINT}?q=x&per=20`]: () =>
      jsonResponse({
        blocks: [
          { id: 1, title: 'Text first', image: null },
          { id: 2, image: { display: { url: 'https://cdn.arena.test/a.png' } } },
          { id: 3, title: 'Text middle', image: null },
          { id: 4, image: { display: { url: 'https://cdn.arena.test/b.png' } } },
          { id: 5, image: { display: { url: 'https://cdn.arena.test/c.png' } } },
        ],
      }),
    'https://cdn.arena.test/a.png': imageResponse(MINI_PNG),
    'https://cdn.arena.test/b.png': imageResponse(MINI_JPEG, 'image/jpeg'),
    'https://cdn.arena.test/c.png': imageResponse(MINI_PNG),
  })
  const { drafts, failures } = await discoverReferences(
    { source: 'arena', query: 'x', limit: 2 },
    { fetchImpl, lookupImpl: lookupPublic, endpoints: { arenaSearch: ARENA_ENDPOINT } },
  )
  assert.equal(drafts.length, 2)
  assert.equal(failures.length, 0)
  assert.deepEqual(drafts.map((draft) => draft.mediaType), ['image/png', 'image/jpeg'])
  assert.equal(fetchImpl.calls.length, 3) // search + two images, no third image fetch
})

test('maps Are.na 429 and server errors', async () => {
  const limited = makeFetch({
    [`${ARENA_ENDPOINT}?q=x&per=24`]: () =>
      new Response('{}', {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '7' },
      }),
  })
  let caught
  try {
    await discoverReferences(
      { source: 'arena', query: 'x' },
      { fetchImpl: limited, lookupImpl: lookupPublic, endpoints: { arenaSearch: ARENA_ENDPOINT } },
    )
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof SourceError)
  assert.equal(caught.code, 'rate-limited')
  assert.equal(caught.retryAfter, 7)

  const failing = makeFetch({
    [`${ARENA_ENDPOINT}?q=x&per=24`]: () => new Response('oops', { status: 500 }),
  })
  await assertRejectsWithCode(
    discoverReferences(
      { source: 'arena', query: 'x' },
      { fetchImpl: failing, lookupImpl: lookupPublic, endpoints: { arenaSearch: ARENA_ENDPOINT } },
    ),
    'upstream-error',
  )
})

test('rejects malformed Are.na responses and unsafe endpoints', async () => {
  const malformed = makeFetch({
    [`${ARENA_ENDPOINT}?q=x&per=24`]: () => jsonResponse({ items: [] }),
  })
  await assertRejectsWithCode(
    discoverReferences(
      { source: 'arena', query: 'x' },
      { fetchImpl: malformed, lookupImpl: lookupPublic, endpoints: { arenaSearch: ARENA_ENDPOINT } },
    ),
    'upstream-error',
  )

  const noFetch = async () => {
    throw new Error('fetch must not run')
  }
  await assertRejectsWithCode(
    discoverReferences(
      { source: 'arena', query: 'x' },
      {
        fetchImpl: noFetch,
        lookupImpl: lookupPublic,
        endpoints: { arenaSearch: 'ftp://api.are.na/v2/search' },
      },
    ),
    'upstream-error',
  )
})

// ---------------------------------------------------------------------------
// readReferenceFiles
// ---------------------------------------------------------------------------

test('imports a PNG screenshot from an absolute local path', async (t) => {
  const dir = await tempDir(t)
  const pngPath = join(dir, 'reference-shot.png')
  await copyFile(new URL('./fixtures/harness-light-reference.png', import.meta.url), pngPath)

  const { drafts, failures } = await readReferenceFiles([pngPath])
  assert.deepEqual(failures, [])
  assert.equal(drafts.length, 1)
  const draft = drafts[0]
  assert.equal(draft.name, 'reference-shot.png')
  assert.equal(draft.origin, 'file')
  assert.equal(draft.mediaType, 'image/png')
  assert.equal(draft.sourceUrl, '')
  assert.equal(draft.notes, '')
  assert.deepEqual(draft.tags, ['file'])
  assert.deepEqual(draft.bytes, PNG_BYTES)
})

test('detects JPEG, GIF and WebP local files', async (t) => {
  const dir = await tempDir(t)
  const jpg = join(dir, 'shot.jpg')
  const gif = join(dir, 'shot.gif')
  const webp = join(dir, 'shot.webp')
  await writeFile(jpg, MINI_JPEG)
  await writeFile(gif, MINI_GIF)
  await writeFile(webp, MINI_WEBP)

  const { drafts, failures } = await readReferenceFiles([jpg, gif, webp])
  assert.deepEqual(failures, [])
  assert.deepEqual(
    drafts.map((draft) => draft.mediaType),
    ['image/jpeg', 'image/gif', 'image/webp'],
  )
  assert.deepEqual(
    drafts.map((draft) => draft.name),
    ['shot.jpg', 'shot.gif', 'shot.webp'],
  )
})

test('reports per-path failures without aborting the batch', async (t) => {
  const dir = await tempDir(t)
  const valid = join(dir, 'valid.png')
  await copyFile(new URL('./fixtures/harness-light-reference.png', import.meta.url), valid)
  const missing = join(dir, 'missing.png')
  const directory = join(dir, 'folder.png')
  await mkdir(directory)
  const text = join(dir, 'notes.png')
  await writeFile(text, 'plain text, not an image')
  const empty = join(dir, 'empty.png')
  await writeFile(empty, '')
  const huge = join(dir, 'huge.png')
  await writeFile(huge, '')
  await truncate(huge, MAX_IMAGE_BYTES + 1)

  const inputs = [valid, missing, directory, 'relative/path.png', text, empty, huge, 42]
  const { drafts, failures } = await readReferenceFiles(inputs)
  assert.equal(drafts.length, 1)
  assert.equal(failures.length, 7)
  assert.deepEqual(
    failures.map((failure) => failure.code),
    [
      'file-not-found',
      'invalid-path',
      'invalid-path',
      'unsupported-media-type',
      'invalid-image',
      'image-too-large',
      'invalid-path',
    ],
  )
  assert.equal(failures[0].input, missing)
  assert.equal(failures[2].input, 'relative/path.png')
  assert.equal(failures[6].input, '')
})

test('validates the local file batch shape', async () => {
  await assertRejectsWithCode(readReferenceFiles([]), 'invalid-path')
  await assertRejectsWithCode(
    readReferenceFiles(Array.from({ length: MAX_IMPORT_PATHS + 1 }, () => '/tmp/x.png')),
    'invalid-path',
  )
  await assertRejectsWithCode(readReferenceFiles('/tmp/x.png'), 'invalid-path')
})

// ---------------------------------------------------------------------------
// readSourceConfig + sourceCatalog
// ---------------------------------------------------------------------------

test('returns no key when the config file is absent', async (t) => {
  clearMobbinEnv(t)
  const dir = await tempDir(t)
  assert.deepEqual(readSourceConfig(dir), { mobbinApiKey: null, mobbinKeySource: null })
  assert.deepEqual(readSourceConfig(undefined), { mobbinApiKey: null, mobbinKeySource: null })
  assert.deepEqual(readSourceConfig(''), { mobbinApiKey: null, mobbinKeySource: null })
  assert.doesNotThrow(() => readSourceConfig('/definitely/not/a/real/directory'))
})

test('reads the Mobbin key from sources.json', async (t) => {
  clearMobbinEnv(t)
  const dir = await tempDir(t)
  await writeFile(join(dir, 'sources.json'), JSON.stringify({ mobbinApiKey: 'file-key' }))
  assert.deepEqual(readSourceConfig(dir), { mobbinApiKey: 'file-key', mobbinKeySource: 'file' })
})

test('accepts the snake_case config alias', async (t) => {
  clearMobbinEnv(t)
  const dir = await tempDir(t)
  await writeFile(join(dir, 'sources.json'), JSON.stringify({ mobbin_api_key: 'snake-key' }))
  assert.deepEqual(readSourceConfig(dir), { mobbinApiKey: 'snake-key', mobbinKeySource: 'file' })
})

test('environment key wins over the config file', async (t) => {
  clearMobbinEnv(t)
  const dir = await tempDir(t)
  await writeFile(join(dir, 'sources.json'), JSON.stringify({ mobbinApiKey: 'file-key' }))
  process.env.MOBBIN_API_KEY = 'env-key'
  assert.deepEqual(readSourceConfig(dir), { mobbinApiKey: 'env-key', mobbinKeySource: 'env' })
})

test('malformed, oversized or mistyped config files mean no key', async (t) => {
  clearMobbinEnv(t)
  const dir = await tempDir(t)

  await writeFile(join(dir, 'sources.json'), 'not json at all')
  assert.deepEqual(readSourceConfig(dir), { mobbinApiKey: null, mobbinKeySource: null })

  await writeFile(join(dir, 'sources.json'), JSON.stringify({ mobbinApiKey: 42 }))
  assert.deepEqual(readSourceConfig(dir), { mobbinApiKey: null, mobbinKeySource: null })

  await writeFile(join(dir, 'sources.json'), JSON.stringify({ mobbinApiKey: '   ' }))
  assert.deepEqual(readSourceConfig(dir), { mobbinApiKey: null, mobbinKeySource: null })

  await writeFile(
    join(dir, 'sources.json'),
    JSON.stringify({ mobbinApiKey: 'file-key', padding: 'x'.repeat(70 * 1024) }),
  )
  assert.deepEqual(readSourceConfig(dir), { mobbinApiKey: null, mobbinKeySource: null })

  const notAFile = join(dir, 'sources.json')
  await writeFile(notAFile, '{}')
  assert.doesNotThrow(() => readSourceConfig(dir))
})

test('sourceCatalog reports availability and details', () => {
  const rows = sourceCatalog(null)
  assert.deepEqual(
    rows.map((row) => row.id),
    ['web', 'mobbin', 'arena', 'dribbble'],
  )
  assert.equal(rows[0].kind, 'capture')
  assert.equal(rows[0].available, true)
  assert.equal(rows[1].kind, 'search')
  assert.equal(rows[1].available, false)
  assert.match(rows[1].detail, /MOBBIN_API_KEY/u)
  assert.deepEqual(rows[1].platforms, ['ios', 'web'])
  assert.equal(rows[2].kind, 'search')
  assert.equal(rows[2].available, true)
  assert.equal(rows[3].kind, 'browser')
  assert.equal(rows[3].available, false)
  assert.match(rows[3].detail, /browser MCP|upload a screenshot/iu)

  const configured = sourceCatalog({ mobbinApiKey: 'abc' })
  assert.equal(configured[1].available, true)
  assert.equal(configured[1].detail, 'Mobbin REST API connected.')
  assert.deepEqual(sourceCatalog({ mobbinApiKey: '  ' })[1].available, false)
  assert.equal(sourceCatalog({ mobbinApiKey: 'k' })[0].available, true)
})
