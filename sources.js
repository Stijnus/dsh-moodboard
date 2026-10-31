/**
 * Inspiration source adapters for the Moodboard plugin.
 *
 * Plain ESM, `node:` builtins only, no plugin context. This module only reads
 * public pages/images or a configured discovery API and returns normalized
 * **drafts**; it never touches `ctx.attachments`, the board store, or HTTP
 * routes. The host (`index.js`) owns validation of request bodies, board
 * dedupe, tag/note merging, persistence, and response envelopes.
 *
 * Contract: `docs/CONTRACT.md` § "0.3.0 — Inspiration intake".
 *
 * Safety rules implemented here:
 * - manual redirect following (at most 3 hops), re-validating every hop;
 * - http(s) only, no embedded credentials, DNS/reverse checks against private
 *   and reserved addresses (SSRF);
 * - hard read caps for pages and images plus per-request timeouts;
 * - no cookies, and auth headers only on the configured discovery endpoint;
 * - secrets, fetched bytes, and URLs' query strings are never logged.
 *
 * Every network path accepts injected `fetchImpl`, `lookupImpl`, `endpoints`
 * and `timeoutMs` options so tests run deterministically offline. Defaults are
 * the global `fetch`, `dns.lookup`, and the production endpoints, resolved at
 * call time (never at module load).
 */

import { lookup as dnsLookup } from 'node:dns/promises'
import { readFileSync, statSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { isIP } from 'node:net'
import { basename, isAbsolute, join } from 'node:path'
import { TextDecoder, TextEncoder } from 'node:util'

// ---------------------------------------------------------------------------
// Contract constants
// ---------------------------------------------------------------------------

/** Discovery sources (Dribbble is a browser-only row in the catalog). */
export const SOURCE_IDS = ['web', 'mobbin', 'arena']

/** Maximum links accepted per capture batch. */
export const MAX_IMPORT_URLS = 20

/** Maximum local files accepted per import batch. */
export const MAX_IMPORT_PATHS = 20

/** Maximum discovery results per search. */
export const MAX_DISCOVER_LIMIT = 12

/** Read cap for HTML/JSON request bodies. */
export const MAX_PAGE_BYTES = 4 * 1024 * 1024

/** Read cap for image bytes. */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024

/** Accepted image media types (matches the board/attachment model). */
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** `sources.json` read bound. */
const MAX_CONFIG_BYTES = 64 * 1024

/** Draft field bounds. */
const MAX_URL_CHARS = 2000
const MAX_NAME_CHARS = 200
const MAX_NOTES_CHARS = 4000

/** Default request timeouts (CONTRACT: 15 s page, 25 s API). */
const DEFAULT_PAGE_TIMEOUT_MS = 15000
const DEFAULT_API_TIMEOUT_MS = 25000

/** Manual redirect budget. */
const MAX_REDIRECTS = 3

/** Browser-like UA plus the plugin marker required by the contract. */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 dsh-moodboard/0.3'

/**
 * API UA. Some inspiration APIs (Are.na) reject a browser UA as unidentified
 * automated traffic while accepting an honest agent UA, so API requests never
 * pretend to be a browser.
 */
const API_USER_AGENT = 'dsh-moodboard/0.3 (+https://github.com/Stijnus/dsh-moodboard)'

/** Production discovery endpoints; overridable only for deterministic tests. */
const DEFAULT_ENDPOINTS = Object.freeze({
  mobbinSearch: 'https://api.mobbin.com/v1/screens/search',
  arenaSearch: 'https://api.are.na/v2/search',
})

/** Public Are.na block fallback when a block has no source URL. */
const ARENA_BLOCK_BASE = 'https://www.are.na/block/'

/** Dribbble bot-challenge guidance (CONTRACT). */
const DRIBBBLE_GUIDANCE =
  'Dribbble blocks server-side capture; use the browser MCP workflow or upload a screenshot.'

// ---------------------------------------------------------------------------
// Errors and small utilities
// ---------------------------------------------------------------------------

/**
 * One source failure carrying a contract error code.
 *
 * Codes used as item failures: `invalid-url`, `invalid-path`,
 * `file-not-found`, `unsupported-url`, `unsupported-media-type`,
 * `blocked-source`, `no-preview-image`, `source-unauthorized`,
 * `source-plan-required`, `rate-limited`, `image-too-large`, `invalid-image`,
 * `upstream-error`.
 *
 * Top-level misuse (bad batch shape, bad discover input) throws with
 * `invalid-argument`; a missing Mobbin key throws `source-unavailable`.
 */
export class SourceError extends Error {
  /**
   * @param code - short machine-readable failure code.
   * @param message - short, safe, user-facing description.
   */
  constructor(code, message) {
    super(message)
    this.name = 'SourceError'
    this.code = String(code)
  }
}

/** True for a plain (non-array, non-null) object. */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Coerce a byte source into a `Uint8Array`, or `null` when unsupported. */
function toBytes(value) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return null
}

/** Concatenate byte chunks (copy) into one `Uint8Array`. */
function concatBytes(chunks, total) {
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** Collapse whitespace and trim. */
function collapse(value) {
  return String(value).replace(/\s+/gu, ' ').trim()
}

/** Clip to a maximum number of UTF-16 code units. */
function clip(value, max) {
  const text = String(value)
  return text.length > max ? text.slice(0, max) : text
}

/** A short, safe failure message (never include URLs' query strings). */
function shortMessage(message) {
  const text = typeof message === 'string' ? message : 'The source failed.'
  return clip(text, 300)
}

/** Convert a thrown value into a contract failure item. */
function toFailure(input, error) {
  if (error instanceof SourceError) {
    return { input: typeof input === 'string' ? input : '', code: error.code, message: shortMessage(error.message) }
  }
  return { input: typeof input === 'string' ? input : '', code: 'upstream-error', message: 'The source could not be read.' }
}

/** Validate a batch input array (1..max strings) or throw `invalid-argument`. */
function normalizeBatch(values, max, label, code) {
  if (!Array.isArray(values) || values.length < 1 || values.length > max) {
    throw new SourceError(code, `${label} must be an array of 1..${max} entries.`)
  }
  return values
}

/** Validate the media type portion of a `content-type` header. */
function baseMediaType(contentType) {
  const value = typeof contentType === 'string' ? contentType : ''
  return value.split(';')[0].trim().toLowerCase()
}

/** Whether a type is one of the accepted image media types. */
function isAcceptedImageType(mediaType) {
  return IMAGE_MEDIA_TYPES.has(mediaType)
}

/** Read a header value from a fetch `Headers` object or a plain object. */
function readHeader(response, name) {
  const headers = response?.headers
  if (headers && typeof headers.get === 'function') {
    const direct = headers.get(name)
    if (direct !== null && direct !== undefined) return String(direct)
    const lower = headers.get(name.toLowerCase())
    if (lower !== null && lower !== undefined) return String(lower)
    return ''
  }
  if (isPlainObject(headers)) {
    const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
    return key === undefined ? '' : String(headers[key])
  }
  return ''
}

/** Cancel a response body without leaking an unhandled rejection. */
function cancelBody(response) {
  try {
    const pending = response?.body?.cancel?.()
    if (pending && typeof pending.catch === 'function') pending.catch(() => {})
  } catch {
    // A body that is already consumed or null cannot be cancelled; ignore.
  }
}

/** Display host for provenance/tags (IPv6 brackets stripped). */
function displayHost(url) {
  return String(url.hostname).toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '')
}

/** True when the host belongs to dribbble.com. */
function isDribbbleHost(host) {
  return host === 'dribbble.com' || host.endsWith('.dribbble.com')
}

// ---------------------------------------------------------------------------
// Config + catalog
// ---------------------------------------------------------------------------

/** Read `MOBBIN_API_KEY` from the process environment, or `null`. */
function readEnvKey() {
  const value = process.env.MOBBIN_API_KEY
  if (typeof value !== 'string') return null
  const key = value.trim()
  return key === '' ? null : key
}

/**
 * Read the optional `<dataDir>/sources.json` config. Never throws and never
 * logs the key. `MOBBIN_API_KEY` wins over the file.
 * @param dataDir - plugin data directory (may be missing/undefined).
 * @returns `{ mobbinApiKey: string|null, mobbinKeySource: 'env'|'file'|null }`.
 */
export function readSourceConfig(dataDir) {
  const fallback = { mobbinApiKey: null, mobbinKeySource: null }
  const envKey = readEnvKey()
  if (envKey !== null) return { mobbinApiKey: envKey, mobbinKeySource: 'env' }
  if (typeof dataDir !== 'string' || dataDir.trim() === '') return fallback

  let configPath
  try {
    configPath = join(dataDir, 'sources.json')
  } catch {
    return fallback
  }

  try {
    const stats = statSync(configPath)
    if (!stats.isFile() || stats.size < 1 || stats.size > MAX_CONFIG_BYTES) return fallback
    const raw = readFileSync(configPath, 'utf8')
    if (utf8ByteLength(raw) > MAX_CONFIG_BYTES) return fallback
    const parsed = JSON.parse(raw)
    if (!isPlainObject(parsed)) return fallback
    const value = parsed.mobbinApiKey ?? parsed.mobbin_api_key
    if (typeof value !== 'string') return fallback
    const key = value.trim()
    if (key === '') return fallback
    return { mobbinApiKey: key, mobbinKeySource: 'file' }
  } catch {
    return fallback
  }
}

/** UTF-8 byte length without importing `node:buffer`. */
function utf8ByteLength(text) {
  return new TextEncoder().encode(text).byteLength
}

/**
 * Catalog rows shown by the panel and the `sources` tool action.
 * @param config - result of `readSourceConfig` (or undefined).
 */
export function sourceCatalog(config) {
  const key = typeof config?.mobbinApiKey === 'string' && config.mobbinApiKey.trim() !== ''
  return [
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
      available: key,
      detail: key
        ? 'Mobbin REST API connected.'
        : 'Set MOBBIN_API_KEY (Team/Enterprise) to search Mobbin screens.',
      platforms: ['ios', 'web'],
    },
    {
      id: 'arena',
      kind: 'search',
      label: 'Are.na',
      available: true,
      detail: 'Public Are.na search, no key needed.',
    },
    {
      id: 'dribbble',
      kind: 'browser',
      label: 'Dribbble',
      available: false,
      detail: DRIBBBLE_GUIDANCE,
    },
  ]
}

// ---------------------------------------------------------------------------
// Image signatures
// ---------------------------------------------------------------------------

/**
 * Detect one of the four accepted image media types from magic bytes.
 * @param bytes - `Uint8Array`/`Buffer`/`ArrayBuffer` image bytes.
 * @returns `image/png` | `image/jpeg` | `image/webp` | `image/gif` | `''`.
 */
export function detectImageMediaType(bytes) {
  const data = toBytes(bytes)
  if (data === null) return ''
  const length = data.byteLength

  if (
    length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return 'image/png'
  }

  if (length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'

  if (length >= 6) {
    const gif = String.fromCharCode(data[0], data[1], data[2], data[3], data[4], data[5])
    if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif'
  }

  if (
    length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return 'image/webp'
  }

  return ''
}

// ---------------------------------------------------------------------------
// URL safety (SSRF)
// ---------------------------------------------------------------------------

/** Failure for a syntactically invalid link. */
function invalidUrlError() {
  return new SourceError('invalid-url', 'Link is not a valid URL.')
}

/** Failure for a link pointing at a private/reserved address. */
function privateAddressError() {
  return new SourceError('unsupported-url', 'This link points to a private or local network address.')
}

/** Parse an http(s) URL without throwing; returns `null` when unsafe-shaped. */
function parseHttpUrl(value) {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (raw === '' || raw.length > MAX_URL_CHARS) return null
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '') return null
  return url
}

/** Validate a user-supplied/followed link, or throw a contract failure. */
function assertSafeUrl(value) {
  if (typeof value !== 'string') throw invalidUrlError()
  const raw = value.trim()
  if (raw === '') throw invalidUrlError()
  if (raw.length > MAX_URL_CHARS) {
    throw new SourceError('invalid-url', `Links must be at most ${MAX_URL_CHARS} characters.`)
  }
  let url
  try {
    url = new URL(raw)
  } catch {
    throw invalidUrlError()
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SourceError('unsupported-url', 'Only http and https links are supported.')
  }
  if (url.username !== '' || url.password !== '') {
    throw new SourceError('invalid-url', 'Links with embedded credentials are not allowed.')
  }
  return url
}

/** True for an IPv4 address in a private, loopback, link-local, CGNAT or reserved range. */
function isPrivateIPv4(address) {
  const parts = address.split('.')
  if (parts.length !== 4) return true
  const octets = parts.map((part) => Number(part))
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true
  const [a, b, c] = octets
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 198 && b === 51 && c === 100) return true
  if (a === 203 && b === 0 && c === 113) return true
  if (a >= 224) return true
  return false
}

/** Expand an IPv6 literal into eight numeric groups, or `null` when malformed. */
function expandIPv6(address) {
  const text = address.toLowerCase().split('%')[0]
  const halves = text.split('::')
  if (halves.length > 2) return null
  const left = halves[0] === '' ? [] : halves[0].split(':')
  const right = halves.length === 2 && halves[1] !== '' ? halves[1].split(':') : []
  if (halves.length === 1 && left.length !== 8) return null
  const groups = [...left]
  while (groups.length + right.length < 8) groups.push('0')
  groups.push(...right)
  if (groups.length !== 8) return null
  const values = groups.map((group) => (/^[0-9a-f]{1,4}$/u.test(group) ? Number.parseInt(group, 16) : Number.NaN))
  return values.some((value) => Number.isNaN(value)) ? null : values
}

/** True for an IPv6 address that is loopback, unspecified, ULA, link-local, mapped-private or multicast. */
function isPrivateIPv6(address) {
  const text = address.toLowerCase()
  const mappedCut = text.indexOf('::ffff:')
  if (mappedCut === 0) {
    const mapped = text.slice('::ffff:'.length)
    if (isIP(mapped) === 4) return isPrivateIPv4(mapped)
    const halves = mapped.split(':')
    if (halves.length === 2) {
      const high = Number.parseInt(halves[0], 16)
      const low = Number.parseInt(halves[1], 16)
      if (Number.isFinite(high) && Number.isFinite(low)) {
        const embedded = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`
        return isPrivateIPv4(embedded)
      }
    }
    return true
  }
  const groups = expandIPv6(text)
  if (groups === null) return true
  if (groups.every((group) => group === 0)) return true
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true
  if ((groups[0] & 0xfe00) === 0xfc00) return true
  if ((groups[0] & 0xffc0) === 0xfe80) return true
  if ((groups[0] & 0xff00) === 0xff00) return true
  // IPv6 transition ranges can embed an IPv4 destination; decode and reject a
  // private/reserved embedded address (NAT64, 6to4, IPv4-translated).
  if (groups[0] === 0x0064 && groups[1] === 0xff9b) {
    if (groups[2] === 0x0001) return true // 64:ff9b:1::/48 local-use NAT64
    if (groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0) {
      return isPrivateIPv4(`${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`)
    }
  }
  if (groups[0] === 0x2002) {
    return isPrivateIPv4(`${groups[1] >> 8}.${groups[1] & 0xff}.${groups[2] >> 8}.${groups[2] & 0xff}`)
  }
  // Teredo and benchmarking ranges are transitional/reserved; block them whole.
  if (groups[0] === 0x2001 && groups[1] === 0x0000) return true
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true
  if (groups[0] === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) return true
  // IPv4-mapped/compatible forms written as groups (`::ffff:7f00:1`, `::7f00:1`).
  if (groups.slice(0, 5).every((group) => group === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
    const embedded = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`
    return isPrivateIPv4(embedded)
  }
  return false
}

/** True for an IP literal in a private/reserved range (unknown forms fail closed). */
function isPrivateAddress(address) {
  const value = address.trim().toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '')
  const family = isIP(value)
  if (family === 4) return isPrivateIPv4(value)
  if (family === 6) return isPrivateIPv6(value)
  return true
}

/** True for localhost/*.local/*.internal names and private IP literals. */
function isPrivateHostname(hostname) {
  const host = String(hostname).toLowerCase().replace(/\.$/u, '').replace(/^\[/u, '').replace(/\]$/u, '')
  if (host === '') return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true
  }
  if (isIP(host) === 0) return false
  return isPrivateAddress(host)
}

/**
 * Reject a host that is private or resolves to any private address.
 * @param hostname - URL hostname.
 * @param lookupImpl - DNS lookup injected for deterministic tests.
 */
async function assertPublicAddress(hostname, lookupImpl) {
  const host = String(hostname).toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '')
  if (isPrivateHostname(host)) throw privateAddressError()
  if (isIP(host) !== 0) return

  let records
  try {
    records = await lookupImpl(host, { all: true })
  } catch {
    throw new SourceError('upstream-error', 'Could not resolve this host.')
  }
  const list = Array.isArray(records) ? records : records === undefined || records === null ? [] : [records]
  if (list.length === 0) throw new SourceError('upstream-error', 'Could not resolve this host.')
  for (const record of list) {
    const address = typeof record === 'string' ? record : record?.address
    if (typeof address !== 'string' || isPrivateAddress(address)) throw privateAddressError()
  }
}

// ---------------------------------------------------------------------------
// HTML metadata extraction (pure)
// ---------------------------------------------------------------------------

/** Common named HTML entities used in titles/descriptions. */
const NAMED_ENTITIES = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  minus: '−',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  sbquo: '‚',
  bdquo: '„',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  laquo: '«',
  raquo: '»',
  times: '×',
  divide: '÷',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
  plusmn: '±',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  sup2: '²',
  sup3: '³',
  micro: 'µ',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  pi: 'π',
  omega: 'ω',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  hearts: '♥',
  star: '☆',
})

/** Decode common named and numeric HTML entities. */
function decodeEntities(text) {
  return String(text)
    .replace(/&#(x?)([0-9a-fA-F]+);/gu, (match, hex, digits) => {
      const code = Number.parseInt(digits, hex === '' ? 10 : 16)
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) return match
      if (code >= 0xd800 && code <= 0xdfff) return match
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    })
    .replace(/&([a-zA-Z][a-zA-Z0-9]{1,31});/gu, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
}

/** Decode entities and collapse markup/whitespace into one clean line. */
function cleanText(value) {
  if (typeof value !== 'string') return ''
  return collapse(decodeEntities(value.replace(/<[^>]*>/gu, ' ')))
}

/** Parse tag attributes into a null-prototype map (lowercase names). */
function parseAttributes(source) {
  const attrs = Object.create(null)
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu
  let match
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1].toLowerCase()
    if (name in attrs) continue
    attrs[name] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attrs
}

/** Resolve a possibly-relative URL against a base and require http(s). */
function resolveHttpUrl(value, baseUrl) {
  if (typeof value !== 'string') return ''
  const decoded = decodeEntities(value).trim()
  if (decoded === '') return ''
  let url
  try {
    if (baseUrl === '') {
      url = new URL(decoded)
    } else {
      try {
        url = new URL(decoded, baseUrl)
      } catch {
        url = new URL(decoded)
      }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.href
  } catch {
    return ''
  }
}

/** First non-empty cleaned value. */
function firstClean(values) {
  for (const value of values) {
    const cleaned = cleanText(value)
    if (cleaned !== '') return cleaned
  }
  return ''
}

/**
 * Extract page metadata used to build one captured draft. Pure.
 *
 * Priority (CONTRACT): images `og:image`, `og:image:url`, `twitter:image`,
 * `twitter:image:src`, `link[rel=image_src]`, `meta[itemprop=image]`, first
 * `<img src>`; title `og:title`, `twitter:title`, `<title>`, `og:site_name`,
 * hostname; description `og:description`, `meta[name=description]`,
 * `twitter:description`; author `meta[name=author]`, `article:author`,
 * `twitter:creator`; site `og:site_name` or hostname.
 *
 * @param html - raw HTML text.
 * @param baseUrl - final page URL used to resolve relative links.
 * @returns `{ title, description, author, site, canonical, imageUrl, imageCandidates }`.
 */
export function extractPageMetadata(html, baseUrl) {
  const source = typeof html === 'string' ? html : ''
  const base = typeof baseUrl === 'string' ? baseUrl.trim() : ''

  let pageTitle = ''
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(source)
  if (titleMatch !== null) pageTitle = titleMatch[1]

  const meta = new Map()
  const imageSrcs = []
  const imageLinks = []
  let canonicalRaw = ''

  const tagPattern = /<(meta|link|img)\b([^>]*)>/giu
  let match
  while ((match = tagPattern.exec(source)) !== null) {
    const tag = match[1].toLowerCase()
    const attrs = parseAttributes(match[2])
    if (tag === 'meta') {
      const key = String(attrs.property ?? attrs.name ?? attrs.itemprop ?? '').trim().toLowerCase()
      if (key === '' || attrs.content === undefined) continue
      if (!meta.has(key)) meta.set(key, attrs.content)
    } else if (tag === 'link') {
      const rels = String(attrs.rel ?? '').toLowerCase().split(/\s+/u).filter(Boolean)
      if (rels.includes('canonical') && canonicalRaw === '' && attrs.href !== undefined) canonicalRaw = attrs.href
      if (rels.includes('image_src') && attrs.href !== undefined) imageLinks.push(attrs.href)
    } else if (tag === 'img') {
      if (attrs.src !== undefined) imageSrcs.push(attrs.src)
    }
  }

  const host = base === '' ? '' : safeHostFromBase(base)
  const title = firstClean([meta.get('og:title'), meta.get('twitter:title'), pageTitle, meta.get('og:site_name')]) || host
  const description = firstClean([meta.get('og:description'), meta.get('description'), meta.get('twitter:description')])
  const author = firstClean([meta.get('author'), meta.get('article:author'), meta.get('twitter:creator')])
  const site = firstClean([meta.get('og:site_name')]) || host

  const candidates = []
  const addCandidate = (value) => {
    const resolved = resolveHttpUrl(value, base)
    if (resolved !== '' && !candidates.includes(resolved)) candidates.push(resolved)
  }
  addCandidate(meta.get('og:image'))
  addCandidate(meta.get('og:image:url'))
  addCandidate(meta.get('twitter:image'))
  addCandidate(meta.get('twitter:image:src'))
  for (const value of imageLinks) addCandidate(value)
  addCandidate(meta.get('image'))
  for (const value of imageSrcs) {
    const resolved = resolveHttpUrl(value, base)
    if (resolved !== '') {
      addCandidate(value)
      break
    }
  }

  return {
    title,
    description,
    author,
    site,
    canonical: resolveHttpUrl(canonicalRaw, base),
    imageUrl: candidates[0] ?? '',
    imageCandidates: candidates,
  }
}

/** Best-effort hostname from a base URL string. */
function safeHostFromBase(baseUrl) {
  try {
    const url = new URL(baseUrl)
    return displayHost(url)
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/** Resolve injected transport options with call-time defaults. */
function resolveTransport(options, defaultTimeoutMs) {
  const value = isPlainObject(options) ? options : {}
  const timeoutMs =
    Number.isFinite(value.timeoutMs) && value.timeoutMs > 0 ? Math.floor(value.timeoutMs) : defaultTimeoutMs
  const fetchImpl =
    typeof value.fetchImpl === 'function'
      ? value.fetchImpl
      : typeof globalThis.fetch === 'function'
        ? globalThis.fetch.bind(globalThis)
        : null
  if (fetchImpl === null) {
    throw new SourceError('upstream-error', 'No fetch implementation is available in this runtime.')
  }
  const lookupImpl = typeof value.lookupImpl === 'function' ? value.lookupImpl : dnsLookup
  return { fetchImpl, lookupImpl, timeoutMs }
}

/** Merge injected endpoints over the production defaults. */
function resolveEndpoints(raw) {
  const endpoints = {
    mobbinSearch: DEFAULT_ENDPOINTS.mobbinSearch,
    arenaSearch: DEFAULT_ENDPOINTS.arenaSearch,
  }
  if (isPlainObject(raw)) {
    if (raw.mobbinSearch !== undefined) endpoints.mobbinSearch = raw.mobbinSearch
    if (raw.arenaSearch !== undefined) endpoints.arenaSearch = raw.arenaSearch
  }
  for (const key of Object.keys(endpoints)) {
    const url = parseHttpUrl(endpoints[key])
    if (url === null) throw new SourceError('upstream-error', 'Source endpoints must be http(s) URLs.')
    endpoints[key] = url.href
  }
  return endpoints
}

/** Wrap a transport failure into a safe contract error. */
function transportFailure(error, controller, timeoutMs) {
  if (error instanceof SourceError) return error
  if (controller?.signal?.aborted === true) {
    return new SourceError('upstream-error', `The request timed out after ${Math.round(timeoutMs / 1000)}s.`)
  }
  const code = error?.cause?.code ?? error?.code
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENODATA') {
    return new SourceError('upstream-error', 'Could not resolve this host.')
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EPIPE') {
    return new SourceError('upstream-error', 'The site did not respond.')
  }
  return new SourceError('upstream-error', 'Could not reach the site.')
}

/** Build the failure used when a response exceeds a read cap. */
function oversizedError(limit, mediaType) {
  if (isAcceptedImageType(mediaType) || mediaType.startsWith('image/')) {
    return new SourceError('image-too-large', `The image is larger than ${Math.round(limit / (1024 * 1024))} MiB.`)
  }
  return new SourceError('upstream-error', 'The response is too large to read.')
}

/** Read a response body with a hard byte cap enforced while streaming. */
async function readResponseBody(response, maxBytes) {
  const declared = Number(readHeader(response, 'content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    cancelBody(response)
    throw oversizedError(maxBytes, baseMediaType(readHeader(response, 'content-type')))
  }

  const body = response?.body
  if (body !== null && body !== undefined && typeof body.getReader === 'function') {
    const reader = body.getReader()
    const chunks = []
    let total = 0
    for (;;) {
      const step = await reader.read()
      if (step?.done === true) break
      const chunk = toBytes(step?.value)
      if (chunk === null) continue
      total += chunk.byteLength
      if (total > maxBytes) {
        try {
          await reader.cancel()
        } catch {
          // Already-closed streams cannot be cancelled; the cap still applies.
        }
        throw oversizedError(maxBytes, baseMediaType(readHeader(response, 'content-type')))
      }
      chunks.push(chunk)
    }
    return concatBytes(chunks, total)
  }

  if (typeof response?.arrayBuffer === 'function') {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw oversizedError(maxBytes, baseMediaType(readHeader(response, 'content-type')))
    return bytes
  }
  if (typeof response?.text === 'function') {
    const bytes = new TextEncoder().encode(await response.text())
    if (bytes.byteLength > maxBytes) throw oversizedError(maxBytes, baseMediaType(readHeader(response, 'content-type')))
    return bytes
  }
  return new Uint8Array(0)
}

/**
 * Fetch a URL, following at most three redirects manually and re-validating
 * every hop (scheme, credentials, private addresses, DNS).
 *
 * @returns `{ status, headers, contentType, bytes, finalUrl }` where
 * `finalUrl` is the URL object of the final response.
 */
async function requestWithRedirects(rawUrl, config) {
  const { fetchImpl, lookupImpl, timeoutMs, method = 'GET', headers = {}, body, maxBytes, accept } = config
  let current = typeof rawUrl === 'string' ? rawUrl : ''
  let redirects = 0

  for (;;) {
    const url = assertSafeUrl(current)
    await assertPublicAddress(displayHost(url), lookupImpl)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetchImpl(url.href, {
        method,
        headers: {
          'user-agent': USER_AGENT,
          accept: accept ?? '*/*',
          ...headers,
        },
        body,
        redirect: 'manual',
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timer)
      throw transportFailure(error, controller, timeoutMs)
    }

    const status = Number(response?.status) || 0
    if (status >= 300 && status < 400) {
      clearTimeout(timer)
      cancelBody(response)
      if (redirects >= MAX_REDIRECTS) {
        throw new SourceError('upstream-error', 'The link redirected too many times.')
      }
      const location = readHeader(response, 'location')
      if (location === '') throw new SourceError('upstream-error', 'The link redirected without a destination.')
      let next
      try {
        next = new URL(location, url.href).href
      } catch {
        throw new SourceError('upstream-error', 'The link redirected to an invalid URL.')
      }
      redirects += 1
      current = next
      continue
    }

    const contentType = baseMediaType(readHeader(response, 'content-type'))
    const limit = typeof maxBytes === 'function' ? maxBytes(contentType) : Number(maxBytes) || MAX_PAGE_BYTES
    let bytes
    try {
      bytes = await readResponseBody(response, limit)
    } catch (error) {
      clearTimeout(timer)
      throw transportFailure(error, controller, timeoutMs)
    }
    clearTimeout(timer)
    return { status, headers: response?.headers, contentType, bytes, finalUrl: url }
  }
}

/** Decode UTF-8 bytes; replacement characters are fine for metadata parsing. */
function decodeUtf8(bytes) {
  return new TextDecoder('utf-8').decode(bytes)
}

/** Request a JSON discovery endpoint without forwarding auth across redirects. */
async function requestApiJson(rawUrl, config) {
  const { fetchImpl, lookupImpl, timeoutMs, method = 'GET', headers = {}, body } = config
  const url = assertSafeUrl(rawUrl)
  await assertPublicAddress(displayHost(url), lookupImpl)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetchImpl(url.href, {
      method,
      headers: {
        'user-agent': API_USER_AGENT,
        accept: 'application/json',
        ...headers,
      },
      body,
      redirect: 'manual',
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timer)
    throw transportFailure(error, controller, timeoutMs)
  }

  const status = Number(response?.status) || 0
  if (status >= 300 && status < 400) {
    clearTimeout(timer)
    cancelBody(response)
    throw new SourceError('upstream-error', 'The source API redirected unexpectedly.')
  }

  let bytes
  try {
    bytes = await readResponseBody(response, MAX_PAGE_BYTES)
  } catch (error) {
    clearTimeout(timer)
    throw transportFailure(error, controller, timeoutMs)
  }
  clearTimeout(timer)
  return { status, headers: response?.headers, text: decodeUtf8(bytes) }
}

/** Parse a JSON object response or throw `upstream-error`. */
function parseJsonObject(text) {
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new SourceError('upstream-error', 'The source returned invalid JSON.')
  }
  if (!isPlainObject(payload)) throw new SourceError('upstream-error', 'The source returned an unexpected response.')
  return payload
}

/** Retry-After in seconds, when present and parseable. */
function retryAfterSeconds(headers) {
  const raw = readHeader({ headers }, 'retry-after').trim()
  if (raw === '') return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)
  const at = Date.parse(raw)
  if (Number.isNaN(at)) return null
  return Math.max(0, Math.ceil((at - Date.now()) / 1000))
}

/** Build a rate-limited error that carries the parsed retry delay. */
function rateLimitedError(label, headers) {
  const retryAfter = retryAfterSeconds(headers)
  const suffix = retryAfter === null ? '' : ` Try again in ${retryAfter}s.`
  const error = new SourceError('rate-limited', `${label} rate limit reached.${suffix}`)
  if (retryAfter !== null) error.retryAfter = retryAfter
  return error
}

/** Download one image URL with SSRF checks, redirects, size cap and signature validation. */
async function downloadImage(rawUrl, transport, accept = 'image/*,*/*;q=0.5') {
  const result = await requestWithRedirects(rawUrl, {
    ...transport,
    headers: { accept },
    maxBytes: MAX_IMAGE_BYTES,
  })
  if (result.status < 200 || result.status >= 300) {
    throw new SourceError('upstream-error', `The image request returned HTTP ${result.status}.`)
  }
  const declared = result.contentType
  if (declared.startsWith('image/') && !isAcceptedImageType(declared)) {
    throw new SourceError('unsupported-media-type', 'Only PNG, JPEG, WebP and GIF images are supported.')
  }
  const mediaType = detectImageMediaType(result.bytes)
  if (mediaType === '') throw new SourceError('invalid-image', 'The image could not be read.')
  return { bytes: result.bytes, mediaType, finalUrl: result.finalUrl }
}

// ---------------------------------------------------------------------------
// Draft construction
// ---------------------------------------------------------------------------

/** Normalize raw provider tags: strings only, trimmed, empty dropped. */
function normalizeRawTags(values) {
  const tags = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const tag = value.trim()
    if (tag === '') continue
    if (!tags.includes(tag)) tags.push(tag)
  }
  return tags
}

/** Keep a URL as provenance only when it is a syntactically valid http(s) URL. */
function safeSourceUrl(value) {
  const url = parseHttpUrl(value)
  return url === null ? '' : value.trim()
}

/** Build one normalized draft; callers pass already-validated bytes/mediaType. */
function makeDraft(fields) {
  const mediaType = fields.mediaType
  if (!isAcceptedImageType(mediaType)) throw new SourceError('invalid-image', 'Unsupported image type.')
  const bytes = toBytes(fields.bytes)
  if (bytes === null || bytes.byteLength === 0) throw new SourceError('invalid-image', 'The image is empty.')
  return {
    name: clip(collapse(fields.name === undefined ? '' : fields.name), MAX_NAME_CHARS) || 'Reference',
    notes: clip(String(fields.notes ?? ''), MAX_NOTES_CHARS),
    tags: normalizeRawTags(fields.tags ?? []),
    sourceUrl: safeSourceUrl(fields.sourceUrl),
    bytes,
    mediaType,
    origin: fields.origin,
  }
}

/** Name shown for a direct image URL (path basename, else host). */
function imageNameFromUrl(url) {
  const segments = url.pathname.split('/').filter((segment) => segment !== '')
  const last = segments.length === 0 ? '' : segments[segments.length - 1]
  if (last === '') return displayHost(url)
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

/** True when bytes look like an HTML document. */
function looksLikeHtml(bytes) {
  const head = decodeUtf8(bytes.subarray(0, 512)).replace(/^\uFEFF/u, '').trimStart().toLowerCase()
  return head.startsWith('<')
}

/** True for content types that are HTML/XML documents. */
function isHtmlMediaType(mediaType) {
  return (
    mediaType === 'text/html' ||
    mediaType === 'application/xhtml+xml' ||
    mediaType === 'application/xml' ||
    mediaType === 'text/xml'
  )
}

/** True when a Dribbble response is a bot challenge or empty body. */
function isDribbbleBlocked(result) {
  if (result.status === 202 || result.status === 403 || result.status === 429 || result.status === 503) return true
  if (result.bytes.byteLength === 0) return true
  const head = decodeUtf8(result.bytes.subarray(0, 4096)).toLowerCase()
  return (
    head.includes('cf-browser-verification') ||
    head.includes('challenge-platform') ||
    head.includes('just a moment') ||
    head.includes('attention required') ||
    head.includes('enable javascript and cookies') ||
    head.includes('access denied')
  )
}

/** Build the contract notes line for a captured page. */
function capturedPageNotes(meta, host) {
  const site = collapse(meta.site) || host
  const title = collapse(meta.title)
  const author = collapse(meta.author)
  const description = collapse(meta.description)
  const titleIsFallback = title === '' || title.toLowerCase() === host.toLowerCase() || title.toLowerCase() === site.toLowerCase()

  let notes = `Captured from ${site} (${host})`
  if (!titleIsFallback) {
    notes += author === '' ? ` — ${title}` : ` — ${title} by ${author}`
  } else if (author !== '') {
    notes += ` — by ${author}`
  }
  if (description !== '') notes += `. ${description}`
  return notes
}

/** Build one draft for a page whose metadata + preview image are known. */
function pageDraft(meta, pageUrl, image) {
  const host = displayHost(pageUrl)
  const name = collapse(meta.title) || collapse(meta.site) || host
  return makeDraft({
    name,
    notes: capturedPageNotes(meta, host),
    tags: ['web', host],
    sourceUrl: meta.canonical === '' ? pageUrl.href : meta.canonical,
    bytes: image.bytes,
    mediaType: image.mediaType,
    origin: 'web',
  })
}

/**
 * Capture 1..20 public links as drafts.
 *
 * Direct image URLs are stored as-is; HTML pages require a preview image and
 * otherwise fail with `no-preview-image`. Each input is independent, so one
 * failure never aborts the batch. Duplicate URLs (exact string) are skipped.
 *
 * @param urls - array of 1..20 link strings.
 * @param options - `{ fetchImpl, lookupImpl, timeoutMs, tags, notes }`; the
 * `tags`/`notes` inputs are user-owned and merged by the host after adapters,
 * so drafts always carry provider tags/notes only.
 * @returns `{ drafts, failures }`.
 */
export async function captureReferences(urls, options = {}) {
  const inputs = normalizeBatch(urls, MAX_IMPORT_URLS, 'urls', 'invalid-url')
  const transport = resolveTransport(options, DEFAULT_PAGE_TIMEOUT_MS)
  const seen = new Set()
  const drafts = []
  const failures = []

  for (const raw of inputs) {
    const input = typeof raw === 'string' ? raw.trim() : ''
    if (input === '') {
      failures.push({ input, code: 'invalid-url', message: 'Link is not a valid URL.' })
      continue
    }
    if (seen.has(input)) continue
    seen.add(input)
    try {
      const draft = await captureOne(input, transport)
      drafts.push(draft)
    } catch (error) {
      failures.push(toFailure(input, error))
    }
  }
  return { drafts, failures }
}

/** Capture exactly one link (one fetch for an image, page + preview image otherwise). */
async function captureOne(rawUrl, transport) {
  const result = await requestWithRedirects(rawUrl, {
    ...transport,
    headers: { accept: 'text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5' },
    // Read at the image cap unless the response declares an HTML/XML document:
    // a direct image URL can be served with a generic content type
    // (`application/octet-stream`), and the signature decides whether it is an
    // image. Non-HTML bodies are re-capped to the page limit below.
    maxBytes: (contentType) => (isHtmlMediaType(contentType) ? MAX_PAGE_BYTES : MAX_IMAGE_BYTES),
  })

  const finalUrl = result.finalUrl
  const host = displayHost(finalUrl)
  const dribbble = isDribbbleHost(host)
  const declared = result.contentType
  const mediaType = detectImageMediaType(result.bytes)
  const isImageResponse = declared.startsWith('image/') || mediaType !== ''

  if (result.status < 200 || result.status >= 300) {
    if (!isImageResponse && dribbble && isDribbbleBlocked(result)) throw blockedSourceError()
    throw new SourceError('upstream-error', `The site returned HTTP ${result.status}.`)
  }

  if (declared.startsWith('image/') && !isAcceptedImageType(declared)) {
    throw new SourceError('unsupported-media-type', 'Only PNG, JPEG, WebP and GIF images are supported.')
  }

  if (isImageResponse) {
    if (mediaType === '') throw new SourceError('invalid-image', 'The image could not be read.')
    return makeDraft({
      name: imageNameFromUrl(finalUrl),
      notes: `Image from ${host}.`,
      tags: ['web', host],
      sourceUrl: finalUrl.href,
      bytes: result.bytes,
      mediaType,
      origin: 'web',
    })
  }

  if (dribbble && isDribbbleBlocked(result)) throw blockedSourceError()
  if (!isHtmlMediaType(declared) && !looksLikeHtml(result.bytes)) {
    throw new SourceError('unsupported-url', 'This link is not a web page or a supported image.')
  }
  if (result.bytes.byteLength > MAX_PAGE_BYTES) {
    throw new SourceError('upstream-error', 'The page is too large to read.')
  }

  const meta = extractPageMetadata(decodeUtf8(result.bytes), finalUrl.href)
  if (meta.imageUrl === '') {
    throw new SourceError('no-preview-image', 'No preview image found; upload a screenshot instead.')
  }
  const image = await downloadImage(meta.imageUrl, transport)
  return pageDraft(meta, finalUrl, image)
}

/** Dribbble bot-challenge failure with the browser-MCP guidance. */
function blockedSourceError() {
  return new SourceError('blocked-source', DRIBBBLE_GUIDANCE)
}

// ---------------------------------------------------------------------------
// Discovery: Mobbin + Are.na
// ---------------------------------------------------------------------------

/** Validate a discover input object or throw `invalid-argument`. */
function normalizeDiscoverInput(input) {
  if (!isPlainObject(input)) throw new SourceError('invalid-argument', 'Discover input must be an object.')
  const source = typeof input.source === 'string' ? input.source.trim().toLowerCase() : ''
  if (source !== 'mobbin' && source !== 'arena') {
    throw new SourceError('invalid-argument', 'source must be mobbin or arena.')
  }
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (query.length < 1 || query.length > 500) {
    throw new SourceError('invalid-argument', 'query must be between 1 and 500 characters.')
  }

  let platform = 'ios'
  if (source === 'mobbin' && input.platform !== undefined) {
    if (typeof input.platform !== 'string') throw new SourceError('invalid-argument', 'platform must be ios or web.')
    platform = input.platform.trim().toLowerCase()
    if (platform !== 'ios' && platform !== 'web') {
      throw new SourceError('invalid-argument', 'platform must be ios or web.')
    }
  }

  let limit = 6
  if (input.limit !== undefined) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_DISCOVER_LIMIT) {
      throw new SourceError('invalid-argument', `limit must be an integer between 1 and ${MAX_DISCOVER_LIMIT}.`)
    }
    limit = input.limit
  }

  return { source, query, platform, limit }
}

/** Resolve the Mobbin API key from the injected config (env fallback). */
function mobbinKeyFromOptions(options) {
  const config = isPlainObject(options.config) ? options.config : readSourceConfig(null)
  const key = typeof config?.mobbinApiKey === 'string' ? config.mobbinApiKey.trim() : ''
  if (key === '') {
    throw new SourceError(
      'source-unavailable',
      'Mobbin is not configured. Set MOBBIN_API_KEY or add mobbinApiKey to sources.json.',
    )
  }
  return key
}

/** Map Mobbin search HTTP statuses to contract codes. */
function mapMobbinStatus(status, headers) {
  if (status >= 200 && status < 300) return
  if (status === 401) {
    throw new SourceError('source-unauthorized', 'Mobbin rejected the API key (401). Check MOBBIN_API_KEY.')
  }
  if (status === 403) {
    throw new SourceError('source-plan-required', 'Mobbin API search requires a Team or Enterprise plan (403).')
  }
  if (status === 429) throw rateLimitedError('Mobbin', headers)
  throw new SourceError('upstream-error', `Mobbin search failed with HTTP ${status}.`)
}

/** Map Are.na search HTTP statuses to contract codes. */
function mapArenaStatus(status, headers) {
  if (status >= 200 && status < 300) return
  if (status === 401 || status === 403) {
    throw new SourceError('source-unauthorized', 'Are.na refused the public search request.')
  }
  if (status === 429) throw rateLimitedError('Are.na', headers)
  throw new SourceError('upstream-error', `Are.na search failed with HTTP ${status}.`)
}

/** Label one Mobbin screen for per-candidate failures. */
function mobbinScreenLabel(screen) {
  if (typeof screen?.mobbin_url === 'string' && screen.mobbin_url.trim() !== '') return screen.mobbin_url.trim()
  const id = screen?.id
  if (typeof id === 'string' || typeof id === 'number') return `Mobbin screen ${id}`
  if (typeof screen?.app_name === 'string' && screen.app_name.trim() !== '') return `Mobbin ${screen.app_name.trim()}`
  return 'Mobbin screen'
}

/** Build one Mobbin draft; image URLs expire, so download immediately. */
async function mobbinDraft(screen, context) {
  const { query, platform, transport } = context
  let imageUrl = ''
  if (typeof screen?.image?.url === 'string') imageUrl = screen.image.url
  else if (typeof screen?.image_url === 'string') imageUrl = screen.image_url
  else if (typeof screen?.image === 'string') imageUrl = screen.image
  if (imageUrl.trim() === '') {
    throw new SourceError('no-preview-image', 'This Mobbin screen has no preview image.')
  }

  const image = await downloadImage(imageUrl.trim(), transport)
  const appName = typeof screen?.app_name === 'string' ? collapse(screen.app_name) : ''
  const mobbinUrl = safeSourceUrl(screen?.mobbin_url)
  const id = typeof screen?.id === 'string' || typeof screen?.id === 'number' ? String(screen.id) : ''
  const name = appName === '' ? query : `${appName} — ${query}`

  let notes = `Mobbin reference${appName === '' ? '' : ` from ${appName}`} (${platform}) for the query "${query}".`
  if (mobbinUrl !== '') notes += ` Source: ${mobbinUrl}`
  else if (id !== '') notes += ` Screen id: ${id}`

  return makeDraft({
    name,
    notes,
    tags: ['mobbin', platform, appName],
    sourceUrl: mobbinUrl,
    bytes: image.bytes,
    mediaType: image.mediaType,
    origin: 'mobbin',
  })
}

/** Search Mobbin screens through the REST API. */
async function discoverMobbin(request, transport, endpoints, options) {
  const apiKey = mobbinKeyFromOptions(options)
  const payload = JSON.stringify({
    query: request.query,
    platform: request.platform,
    mode: 'standard',
    limit: request.limit,
  })
  const response = await requestApiJson(endpoints.mobbinSearch, {
    ...transport,
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: payload,
  })
  mapMobbinStatus(response.status, response.headers)
  const body = parseJsonObject(response.text)
  if (!Array.isArray(body.screens)) {
    throw new SourceError('upstream-error', 'Mobbin returned an unexpected response.')
  }

  const drafts = []
  const failures = []
  for (const screen of body.screens.slice(0, request.limit)) {
    const label = mobbinScreenLabel(screen)
    try {
      drafts.push(await mobbinDraft(screen, { query: request.query, platform: request.platform, transport }))
    } catch (error) {
      failures.push(toFailure(label, error))
    }
  }
  return { drafts, failures }
}

/** Pick the best available image URL from one Are.na block. */
function arenaImageUrl(block) {
  const image = block?.image
  if (typeof image === 'string') return image
  if (image !== null && image !== undefined) {
    if (typeof image.large?.url === 'string') return image.large.url
    if (typeof image.display?.url === 'string') return image.display.url
    if (typeof image.original?.url === 'string') return image.original.url
  }
  return ''
}

/** Label one Are.na block for per-candidate failures. */
function arenaBlockLabel(block) {
  const sourceUrl = safeSourceUrl(block?.source?.url)
  if (sourceUrl !== '') return sourceUrl
  const id = block?.id
  if (typeof id === 'string' || typeof id === 'number') return `Are.na block ${id}`
  const title = typeof block?.title === 'string' ? collapse(block.title) : ''
  return title === '' ? 'Are.na reference' : title
}

/** Build one Are.na draft. */
async function arenaDraft(block, transport) {
  const imageUrl = arenaImageUrl(block).trim()
  if (imageUrl === '') throw new SourceError('no-preview-image', 'This Are.na block has no image.')

  const image = await downloadImage(imageUrl, transport)
  const id = typeof block?.id === 'string' || typeof block?.id === 'number' ? String(block.id) : ''
  const title = firstClean([block?.title, block?.source?.title])
  const blockUrl = id === '' ? '' : `${ARENA_BLOCK_BASE}${encodeURIComponent(id)}`
  const sourceUrl = safeSourceUrl(block?.source?.url) || blockUrl

  let notes = id === '' ? 'Are.na reference' : `Are.na block ${id}`
  if (title !== '') notes += ` — ${title}`
  if (sourceUrl !== '') notes += `. Source: ${sourceUrl}`

  return makeDraft({
    name: title === '' ? 'Are.na reference' : title,
    notes,
    tags: ['arena'],
    sourceUrl,
    bytes: image.bytes,
    mediaType: image.mediaType,
    origin: 'arena',
  })
}

/** Search Are.na publicly (no key). */
async function discoverArena(request, transport, endpoints) {
  const searchUrl = endpoints.arenaSearch
  const url = new URL(searchUrl)
  url.searchParams.set('q', request.query)
  // Are.na's `per` is a shared result budget across channels and blocks, so a
  // small `per` can return zero blocks. Ask for a wider page, then take the
  // first `limit` image blocks.
  url.searchParams.set('per', String(Math.min(100, Math.max(20, request.limit * 4))))
  const response = await requestApiJson(url.href, {
    ...transport,
    headers: { accept: 'application/json' },
  })
  mapArenaStatus(response.status, response.headers)
  const body = parseJsonObject(response.text)
  if (!Array.isArray(body.blocks)) {
    throw new SourceError('upstream-error', 'Are.na returned an unexpected response.')
  }

  const drafts = []
  const failures = []
  // Are.na's result list mixes image and text blocks. Only image blocks count
  // against the requested limit; text blocks must not consume the quota.
  const imageBlocks = body.blocks.filter((block) => arenaImageUrl(block).trim() !== '')
  for (const block of imageBlocks.slice(0, request.limit)) {
    const label = arenaBlockLabel(block)
    try {
      drafts.push(await arenaDraft(block, transport))
    } catch (error) {
      failures.push(toFailure(label, error))
    }
  }
  return { drafts, failures }
}

/**
 * Discover references from an inspiration source.
 *
 * Source-level failures (missing key, auth/plan/rate limits, unreachable API)
 * throw a `SourceError`; per-candidate image failures are returned in
 * `failures` so one bad result never aborts the batch.
 *
 * @param input - `{ source: 'mobbin'|'arena', query, platform?, limit? }`.
 * @param options - `{ config, fetchImpl, lookupImpl, endpoints, timeoutMs }`.
 * @returns `{ drafts, failures }`.
 */
export async function discoverReferences(input, options = {}) {
  const request = normalizeDiscoverInput(input)
  const config = isPlainObject(options) ? options : {}
  const transport = resolveTransport(config, DEFAULT_API_TIMEOUT_MS)
  const endpoints = resolveEndpoints(config.endpoints)
  if (request.source === 'mobbin') return discoverMobbin(request, transport, endpoints, config)
  return discoverArena(request, transport, endpoints)
}

// ---------------------------------------------------------------------------
// Local files (browser MCP bridge)
// ---------------------------------------------------------------------------

/** Failure for a bad local path. */
function invalidPathError() {
  return new SourceError('invalid-path', 'Path must be a non-empty absolute file path.')
}

/** True for filesystem "missing entry" errors. */
function isMissingError(error) {
  const code = error?.code
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR'
}

/** Read one absolute local image file into a draft. */
async function readReferenceFile(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') throw invalidPathError()
  const path = rawPath.trim()
  if (!isAbsolute(path)) throw invalidPathError()

  let stats
  try {
    stats = await stat(path)
  } catch (error) {
    if (isMissingError(error)) throw new SourceError('file-not-found', 'File not found.')
    throw new SourceError('invalid-path', 'Could not read this file.')
  }
  if (!stats.isFile()) throw new SourceError('invalid-path', 'Path must be a regular file, not a directory.')
  if (stats.size > MAX_IMAGE_BYTES) {
    throw new SourceError('image-too-large', `Images must be at most ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MiB.`)
  }
  if (stats.size === 0) throw new SourceError('invalid-image', 'The file is empty.')

  let buffer
  try {
    buffer = await readFile(path)
  } catch (error) {
    if (isMissingError(error)) throw new SourceError('file-not-found', 'File not found.')
    throw new SourceError('invalid-path', 'Could not read this file.')
  }
  const bytes = new Uint8Array(buffer)
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new SourceError('image-too-large', `Images must be at most ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MiB.`)
  }
  if (bytes.byteLength === 0) throw new SourceError('invalid-image', 'The file is empty.')

  const mediaType = detectImageMediaType(bytes)
  if (mediaType === '') {
    throw new SourceError('unsupported-media-type', 'Only PNG, JPEG, WebP and GIF images are supported.')
  }

  return makeDraft({
    name: basename(path),
    notes: '',
    tags: ['file'],
    sourceUrl: '',
    bytes,
    mediaType,
    origin: 'file',
  })
}

/**
 * Import 1..20 local screenshot files (browser-MCP or user uploads).
 *
 * @param paths - array of 1..20 absolute file paths.
 * @param options - accepted for interface symmetry; unused.
 * @returns `{ drafts, failures }`.
 */
export async function readReferenceFiles(paths, options = {}) {
  void options
  const inputs = normalizeBatch(paths, MAX_IMPORT_PATHS, 'paths', 'invalid-path')
  const drafts = []
  const failures = []
  for (const raw of inputs) {
    const input = typeof raw === 'string' ? raw : ''
    try {
      drafts.push(await readReferenceFile(raw))
    } catch (error) {
      failures.push(toFailure(input, error))
    }
  }
  return { drafts, failures }
}
