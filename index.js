/**
 * Host half of the Moodboard plugin.
 *
 * A durable board of visual reference images plus tags/notes/pins:
 * - HTTP prefix route `/moodboard`: board state, upload, metadata patch,
 *   replace, delete, active guide, tag query, health, and raw image bytes.
 * - Agent tool `moodboard`: loads the active style guide as text + real image
 *   content blocks so the model can match the user's references.
 * - System prompt section `moodboard:style-guide`: tells the model to load the
 *   board before generating or changing UI.
 *
 * Board metadata lives in `<DSH_HOME>/moodboard/board.json` (atomic
 * temp+rename, serialized writes). Image bytes are only ever stored through
 * `ctx.attachments`; the board keeps the normalized attachment reference.
 *
 * Plain ESM, `node:` builtins only — this bundle has no third-party runtime
 * dependencies.
 */

import { randomBytes } from 'node:crypto'
import { chmod, copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'

/** Plugin name used by the Cordis loader. */
export const name = 'moodboard'

/** Services this plugin requires; all are present in the Web profile. */
export const inject = ['attachments', 'tools', 'systemPrompt', 'webServer', 'connection']

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PREFIX = '/moodboard'
const BOARD_VERSION = 1
const STYLE_GUIDE_SECTION = 'moodboard:style-guide'
const STYLE_GUIDE_ORDER = 2450

/** Data model limits (CONTRACT.md). */
const MAX_IMAGES = 200
const MAX_TAGS = 20
const MAX_TAG_CHARS = 48
const MAX_NOTES_CHARS = 4000
const MAX_SOURCE_URL_CHARS = 2000
const MAX_NAME_CHARS = 200

/** Upload bounds. `data` is standard base64, capped before decoding. */
const MAX_IMAGE_BASE64_CHARS = 32 * 1024 * 1024
const MAX_IMAGE_BODY_BYTES = MAX_IMAGE_BASE64_CHARS + 1024 * 1024
const MAX_PATCH_BODY_BYTES = 64 * 1024

/** Query + brief rendering bounds. */
const DEFAULT_QUERY_LIMIT = 50
const MAX_QUERY_LIMIT = 200
const MAX_BRIEF_LINES = 20
const MAX_BRIEF_LINE_CHARS = 400
const MAX_SECTION_CHARS = 700

/** Agent tool limits. */
const MAX_TOOL_IMAGE_BLOCKS = 6
const TOOL_ACTIONS = ['active', 'list', 'query', 'get', 'brief']
const TOOL_ACTION_SET = new Set(TOOL_ACTIONS)

const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const IMAGE_MEDIA_TYPE_SET = new Set(IMAGE_MEDIA_TYPES)

const IMAGE_ID_PATTERN = /^mb_[0-9a-f]{12}$/
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

const EMPTY_BRIEF =
  'The moodboard is empty. Add reference images in the Moodboard panel (drag and drop or "Add images"), then load them with the moodboard tool.'

/** HTTP error code → status (CONTRACT.md). */
const ERROR_STATUS = Object.freeze({
  unauthorized: 401,
  forbidden: 403,
  'not-found': 404,
  'invalid-body': 400,
  'invalid-query': 400,
  'invalid-image': 400,
  'unsupported-media-type': 415,
  'image-too-large': 413,
  'board-full': 409,
  'storage-failed': 500,
  'method-not-allowed': 405,
})

/** One request failure carrying the contract error code. */
class HttpError extends Error {
  /**
   * @param code - contract error code.
   * @param message - safe, user-facing description.
   */
  constructor(code, message) {
    super(message)
    this.name = 'HttpError'
    this.code = code
    this.status = ERROR_STATUS[code] ?? 500
  }
}

/** Build a contract HTTP failure. */
function httpError(code, message) {
  return new HttpError(code, message)
}

// ---------------------------------------------------------------------------
// Plugin activation
// ---------------------------------------------------------------------------

/**
 * Register the HTTP route, agent tool, and prompt section. Board load starts
 * immediately but never blocks activation.
 * @param ctx - Cordis context exposing the five injected services.
 */
export function apply(ctx) {
  const store = createBoardStore(ctx)
  store.start()

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: (request, response) => {
        void serve(store, ctx, request, response).catch((error) => {
          safeLog(ctx, 'warn', `moodboard: unhandled request failure: ${safeMessage(error)}`)
          if (response.writableEnded === true) return
          if (response.headersSent === true) {
            response.destroy?.()
            return
          }
          sendJsonError(response, 'storage-failed', 'the moodboard request failed')
        })
      },
    }),
  )

  ctx.effect(() => ctx.tools.register(createMoodboardTool(store)))
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: STYLE_GUIDE_SECTION,
      order: STYLE_GUIDE_ORDER,
      text: () => styleGuideSectionText(store),
    }),
  )
}

// ---------------------------------------------------------------------------
// Board store: load, serialize, persist
// ---------------------------------------------------------------------------

/** Absolute `DSH_HOME` for this process. */
function resolveDshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim() !== '') return configured
  return join(homedir(), '.dsh')
}

/** An empty, valid board. */
function emptyBoard() {
  return { version: BOARD_VERSION, updatedAt: null, nextOrder: 0, images: [] }
}

/** Deep clone the in-memory (plain JSON) board before mutating a draft. */
function cloneBoard(board) {
  return JSON.parse(JSON.stringify(board))
}

/**
 * Create the single writer for one plugin activation. All mutations run
 * through one promise chain; a failed write never desynchronizes the in-memory
 * read model (the board is swapped only after the rename succeeds).
 * @param ctx - plugin context (logger only, for warnings).
 */
function createBoardStore(ctx) {
  const dataDir = join(resolveDshHome(), 'moodboard')
  const boardPath = join(dataDir, 'board.json')

  let board = emptyBoard()
  let loaded = false
  let started = false
  let readyPromise = Promise.resolve()
  let writeChain = Promise.resolve()
  let dirPromise

  /** Create the data directory with mode 0700 (retried after a failure). */
  function ensureDirectory() {
    if (dirPromise === undefined) {
      dirPromise = (async () => {
        await mkdir(dataDir, { recursive: true, mode: 0o700 })
        await chmod(dataDir, 0o700).catch(() => {})
      })().catch((error) => {
        dirPromise = undefined
        throw error
      })
    }
    return dirPromise
  }

  /** Copy an unreadable board file aside, then continue with an empty board. */
  async function quarantine(reason) {
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
    const backupPath = join(dataDir, `board.corrupt-${stamp}.json`)
    try {
      await copyFile(boardPath, backupPath)
      await chmod(backupPath, 0o600).catch(() => {})
    } catch (error) {
      safeLog(ctx, 'warn', `moodboard: could not back up ${boardPath}: ${safeMessage(error)}`)
    }
    safeLog(ctx, 'warn', `moodboard: ${boardPath} ${reason}; starting with an empty board (backup: ${backupPath})`)
  }

  /** Read and normalize the durable board; corrupt input becomes an empty board. */
  async function load() {
    await ensureDirectory()

    let raw
    try {
      raw = await readFile(boardPath, 'utf8')
    } catch (error) {
      if (isFileMissing(error)) {
        board = emptyBoard()
        loaded = true
        return
      }
      throw error
    }

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      await quarantine('is not valid JSON')
      board = emptyBoard()
      loaded = true
      return
    }

    const normalized = normalizeStoredBoard(parsed)
    if (normalized === null) {
      await quarantine('does not match the board schema')
      board = emptyBoard()
      loaded = true
      return
    }

    board = normalized
    loaded = true
  }

  /** Write a full board snapshot atomically: temp file in the same dir + rename. */
  async function persist(snapshot) {
    await ensureDirectory()
    const json = `${JSON.stringify(snapshot, null, 2)}\n`
    const tmpPath = `${boardPath}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
    try {
      await writeFile(tmpPath, json, { mode: 0o600 })
      await rename(tmpPath, boardPath)
    } catch (error) {
      await unlink(tmpPath).catch(() => {})
      throw error
    }
  }

  /**
   * Apply one mutation to a draft and persist it. The in-memory board is
   * replaced only after the durable write succeeds, so a storage failure never
   * leaves the read model ahead of disk.
   * @param mutate - async callback receiving the draft; its return value is
   *   forwarded to the caller after the commit.
   */
  function mutate(mutate) {
    const run = writeChain.then(async () => {
      await readyPromise
      const draft = cloneBoard(board)
      const result = await mutate(draft)
      draft.version = BOARD_VERSION
      draft.updatedAt = new Date().toISOString()
      try {
        await persist(draft)
      } catch (error) {
        safeLog(ctx, 'warn', `moodboard: could not persist ${boardPath}: ${safeMessage(error)}`)
        throw httpError('storage-failed', 'the moodboard could not be saved to disk')
      }
      board = draft
      return result
    })
    writeChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  return {
    /** Kick off the lazy activation load (never rejects). */
    start() {
      if (started) return readyPromise
      started = true
      readyPromise = load().catch((error) => {
        safeLog(ctx, 'warn', `moodboard: could not load ${boardPath}: ${safeMessage(error)}`)
        board = emptyBoard()
        loaded = true
      })
      return readyPromise
    },
    /** Resolves once the activation load finished (successfully or not). */
    ready() {
      return readyPromise
    },
    /** Whether the durable board has been read (used by the sync prompt text). */
    isLoaded() {
      return loaded
    },
    /** Current in-memory read model; treat as immutable outside `mutate`. */
    current() {
      return board
    },
    mutate,
  }
}

/** ENOENT check that survives errors crossing package boundaries. */
function isFileMissing(error) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Normalize a parsed board file; `null` means "corrupt, back it up". */
function normalizeStoredBoard(value) {
  if (!isPlainObject(value)) return null
  if (value.version !== BOARD_VERSION) return null
  if (!Array.isArray(value.images)) return null

  const images = []
  const seenIds = new Set()
  let maxOrder = -1
  for (const rawImage of value.images) {
    const image = normalizeStoredImage(rawImage, seenIds, images.length)
    if (image === null) continue
    images.push(image)
    if (image.order > maxOrder) maxOrder = image.order
    if (images.length >= MAX_IMAGES) break
  }

  const storedNextOrder = Number.isSafeInteger(value.nextOrder) && value.nextOrder >= 0 ? value.nextOrder : 0
  const nextOrder = Math.max(storedNextOrder, maxOrder + 1, images.length)
  const updatedAt = typeof value.updatedAt === 'string' && value.updatedAt !== '' ? value.updatedAt : null
  return { version: BOARD_VERSION, updatedAt, nextOrder, images }
}

/** Normalize one stored image entry; `null` means "drop this entry". */
function normalizeStoredImage(value, seenIds, fallbackOrder) {
  if (!isPlainObject(value)) return null
  const id = typeof value.id === 'string' && IMAGE_ID_PATTERN.test(value.id) && !seenIds.has(value.id) ? value.id : null
  const attachment = normalizeStoredAttachment(value.attachment)
  if (id === null || attachment === null) return null
  seenIds.add(id)

  const createdAt = typeof value.createdAt === 'string' && value.createdAt !== '' ? value.createdAt : new Date().toISOString()
  const updatedAt = typeof value.updatedAt === 'string' && value.updatedAt !== '' ? value.updatedAt : createdAt
  return {
    id,
    name: sanitizeName(value.name) || sanitizeName(attachment.name) || 'image',
    attachment,
    tags: Array.isArray(value.tags) ? normalizeTagList(value.tags, false) : [],
    notes: typeof value.notes === 'string' ? value.notes.slice(0, MAX_NOTES_CHARS) : '',
    sourceUrl: normalizeStoredSourceUrl(value.sourceUrl),
    pinned: value.pinned === true,
    order: Number.isSafeInteger(value.order) && value.order >= 0 ? value.order : fallbackOrder,
    createdAt,
    updatedAt,
  }
}

/** Normalize one stored normalized attachment reference; `null` means unusable. */
function normalizeStoredAttachment(value) {
  if (!isPlainObject(value)) return null
  const attachmentId = typeof value.attachmentId === 'string' && value.attachmentId !== '' ? value.attachmentId : null
  const mediaType = typeof value.mediaType === 'string' && IMAGE_MEDIA_TYPE_SET.has(value.mediaType) ? value.mediaType : null
  const bytes = Number.isSafeInteger(value.bytes) && value.bytes > 0 ? value.bytes : null
  const width = Number.isSafeInteger(value.width) && value.width > 0 ? value.width : null
  const height = Number.isSafeInteger(value.height) && value.height > 0 ? value.height : null
  if (attachmentId === null || mediaType === null || bytes === null || width === null || height === null) return null

  const attachment = { attachmentId, mediaType, bytes, width, height }
  if (typeof value.name === 'string' && value.name !== '') attachment.name = value.name.slice(0, MAX_NAME_CHARS)
  const original = value.originalDimensions
  if (isPlainObject(original) && Number.isSafeInteger(original.width) && original.width > 0 && Number.isSafeInteger(original.height) && original.height > 0) {
    attachment.originalDimensions = { width: original.width, height: original.height }
  }
  return attachment
}

// ---------------------------------------------------------------------------
// HTTP: admission + dispatch
// ---------------------------------------------------------------------------

/**
 * Serve one `/moodboard` request. Every failure is converted to the JSON error
 * envelope here; nothing escapes to the HTTP server.
 */
async function serve(store, ctx, request, response) {
  try {
    if (!authorize(ctx, request, response)) return

    const url = parseRequestUrl(request)
    const method = typeof request.method === 'string' ? request.method.toUpperCase() : 'GET'
    const segments = splitRoutePath(url.pathname)
    await dispatch(store, ctx, request, response, method, segments, url)
  } catch (error) {
    if (response.writableEnded === true) return
    if (response.headersSent === true) {
      response.destroy?.()
      return
    }
    if (error instanceof HttpError) {
      sendJsonError(response, error.code, error.message)
      return
    }
    safeLog(ctx, 'warn', `moodboard: request failed: ${safeMessage(error)}`)
    sendJsonError(response, 'storage-failed', 'the moodboard request failed')
  }
}

/**
 * Apply the Connection Host/Origin fence and the owner-principal gate.
 * @returns false when a rejection was already written.
 */
function authorize(ctx, request, response) {
  const admission = ctx.connection.admit(request)
  if ('rejection' in admission) {
    const status = admission.rejection === 403 ? 403 : 401
    if (status === 403) sendJsonError(response, 'forbidden', 'this request is not allowed')
    else sendJsonError(response, 'unauthorized', 'authentication is required')
    return false
  }
  const principal = admission.peer?.principal
  if (principal === undefined || principal.kind !== 'owner') {
    sendJsonError(response, 'forbidden', 'this request is not allowed')
    return false
  }
  return true
}

/** Parse the request URL without trusting its shape. */
function parseRequestUrl(request) {
  try {
    return new URL(typeof request.url === 'string' ? request.url : PREFIX, 'http://localhost')
  } catch {
    throw httpError('invalid-query', 'the request URL is malformed')
  }
}

/** Split `/moodboard/...` into decoded-free path segments. */
function splitRoutePath(pathname) {
  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return []
  return pathname
    .slice(PREFIX.length)
    .split('/')
    .filter((segment) => segment !== '')
}

/** Route one request by method + segments. */
async function dispatch(store, ctx, request, response, method, segments, url) {
  if (segments.length === 0) throw httpError('not-found', 'no such moodboard endpoint')

  if (segments[0] === 'image') {
    if (segments.length !== 2) throw httpError('not-found', 'no such moodboard endpoint')
    if (method !== 'GET') throw httpError('method-not-allowed', 'this endpoint supports GET only')
    return handleImageBytes(store, ctx, response, decodeSegment(segments[1]))
  }

  if (segments[0] !== 'api') throw httpError('not-found', 'no such moodboard endpoint')

  if (segments.length === 2) {
    switch (segments[1]) {
      case 'state':
        requireMethod(method, 'GET')
        return handleState(store, response)
      case 'active':
        requireMethod(method, 'GET')
        return handleActive(store, response)
      case 'query':
        requireMethod(method, 'GET')
        return handleQuery(store, response, url)
      case 'health':
        requireMethod(method, 'GET')
        return handleHealth(store, response)
      case 'images':
        requireMethod(method, 'POST')
        return handleCreateImage(store, ctx, request, response)
      default:
        throw httpError('not-found', 'no such moodboard endpoint')
    }
  }

  if (segments.length === 3 && segments[1] === 'tags' && segments[2] === 'merge') {
    requireMethod(method, 'POST')
    return handleMergeTags(store, request, response)
  }

  if (segments.length === 3 && segments[1] === 'images') {
    if (segments[2] === 'reorder') {
      requireMethod(method, 'POST')
      return handleReorderImages(store, request, response)
    }
    if (segments[2] === 'bulk') {
      requireMethod(method, 'POST')
      return handleBulkImages(store, request, response)
    }
    const id = decodeSegment(segments[2])
    if (method === 'PATCH') return handlePatchImage(store, request, response, id)
    if (method === 'DELETE') return handleDeleteImage(store, response, id)
    throw httpError('method-not-allowed', 'this endpoint supports PATCH and DELETE only')
  }

  if (segments.length === 4 && segments[1] === 'images' && segments[3] === 'replace') {
    requireMethod(method, 'POST')
    return handleReplaceImage(store, ctx, request, response, decodeSegment(segments[2]))
  }

  throw httpError('not-found', 'no such moodboard endpoint')
}

/** Assert the route's method and fail with the contract code otherwise. */
function requireMethod(method, expected) {
  if (method !== expected) throw httpError('method-not-allowed', `this endpoint supports ${expected} only`)
}

/** Decode one URL path segment, tolerating malformed escapes. */
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

// ---------------------------------------------------------------------------
// HTTP: API handlers
// ---------------------------------------------------------------------------

/** `GET /api/state` */
async function handleState(store, response) {
  await store.ready()
  sendJson(response, 200, { ok: true, board: boardView(store.current()) })
}

/** `GET /api/health` */
async function handleHealth(store, response) {
  await store.ready()
  sendJson(response, 200, { ok: true, version: BOARD_VERSION, images: store.current().images.length })
}

/** `GET /api/active` */
async function handleActive(store, response) {
  await store.ready()
  const board = store.current()
  const ordered = sortImages(board.images)
  const pinned = ordered.filter((image) => image.pinned)
  const fallback = pinned.length === 0
  const selection = fallback ? ordered : pinned
  const tags = collectTags(board.images)
  sendJson(response, 200, {
    ok: true,
    guide: {
      images: selection.map(imageView),
      allTags: tags.allTags,
      tagCounts: tags.tagCounts,
      fallback,
    },
    brief: buildBrief(selection, fallback ? 'fallback' : 'pinned'),
  })
}

/** `GET /api/query` */
async function handleQuery(store, response, url) {
  await store.ready()
  const tags = readQueryTags(url)
  const match = readQueryMatch(url)
  const limit = readQueryLimit(url)

  const board = store.current()
  const matches = sortImages(board.images).filter((image) => matchesTags(image, tags, match))
  const selected = matches.slice(0, limit)
  sendJson(response, 200, {
    ok: true,
    images: selected.map(imageView),
    brief: buildBrief(selected, tags.length > 0 ? 'query' : 'all', matches.length),
    total: matches.length,
  })
}

/** `POST /api/images` */
async function handleCreateImage(store, ctx, request, response) {
  const body = await readJsonBody(request, MAX_IMAGE_BODY_BYTES, 'image-too-large')
  const upload = readImageUpload(body)
  const tags = readOptionalTags(body)
  const notes = readOptionalNotes(body)
  const sourceUrl = readOptionalSourceUrl(body)

  const image = await store.mutate(async (draft) => {
    if (draft.images.length >= MAX_IMAGES) {
      throw httpError('board-full', `the moodboard already holds the maximum of ${MAX_IMAGES} images`)
    }
    const ref = await saveImageBytes(ctx, upload)
    return createImageEntry(draft, { ref, name: upload.name, tags, notes, sourceUrl })
  })

  sendJson(response, 200, { ok: true, image: imageView(image) })
}

/** `PATCH /api/images/<id>` */
async function handlePatchImage(store, request, response, id) {
  const body = await readJsonBody(request, MAX_PATCH_BODY_BYTES, 'invalid-body')
  const patch = readImagePatch(body)

  const image = await store.mutate((draft) => {
    const target = draft.images.find((entry) => entry.id === id)
    if (target === undefined) throw notFoundImage(id)
    applyImagePatch(draft, target, patch)
    return target
  })

  sendJson(response, 200, { ok: true, image: imageView(image) })
}

/** `POST /api/images/<id>/replace` */
async function handleReplaceImage(store, ctx, request, response, id) {
  const body = await readJsonBody(request, MAX_IMAGE_BODY_BYTES, 'image-too-large')
  const upload = readImageUpload(body)

  const image = await store.mutate(async (draft) => {
    const target = draft.images.find((entry) => entry.id === id)
    if (target === undefined) throw notFoundImage(id)
    const ref = await saveImageBytes(ctx, upload)
    target.attachment = { ...ref }
    if (upload.name !== '') target.name = upload.name
    target.updatedAt = new Date().toISOString()
    return target
  })

  sendJson(response, 200, { ok: true, image: imageView(image) })
}

/** `DELETE /api/images/<id>` */
async function handleDeleteImage(store, response, id) {
  await store.mutate((draft) => {
    const index = draft.images.findIndex((entry) => entry.id === id)
    if (index === -1) throw notFoundImage(id)
    draft.images.splice(index, 1)
  })
  sendJson(response, 200, { ok: true, removed: id })
}

/** `POST /api/images/reorder` — apply a complete manual gallery order in one write. */
async function handleReorderImages(store, request, response) {
  const body = await readJsonBody(request, MAX_PATCH_BODY_BYTES, 'invalid-body')
  const ids = requireIdList(body.ids)

  await store.mutate((draft) => {
    if (ids.length !== draft.images.length) {
      throw httpError('invalid-body', 'ids must contain every board image exactly once')
    }
    const byId = new Map(draft.images.map((image) => [image.id, image]))
    for (const id of ids) {
      if (!byId.has(id)) throw httpError('invalid-body', 'ids must contain every board image exactly once')
    }
    const now = new Date().toISOString()
    ids.forEach((id, index) => {
      const image = byId.get(id)
      image.order = index
      image.updatedAt = now
    })
    draft.nextOrder = ids.length
  })

  sendJson(response, 200, { ok: true })
}

/** `POST /api/images/bulk` — pin, add/remove tags, or delete several images at once. */
async function handleBulkImages(store, request, response) {
  const body = await readJsonBody(request, MAX_PATCH_BODY_BYTES, 'invalid-body')
  const ids = requireIdList(body.ids)
  const pinned = Object.hasOwn(body, 'pinned') ? requirePinned(body.pinned) : undefined
  const addTags = Object.hasOwn(body, 'addTags') ? requireTags(body.addTags) : []
  const removeTags = Object.hasOwn(body, 'removeTags') ? requireTags(body.removeTags) : []
  const remove = Object.hasOwn(body, 'delete') ? requireDeleteFlag(body.delete) : false
  if (pinned === undefined && addTags.length === 0 && removeTags.length === 0 && remove !== true) {
    throw httpError('invalid-body', 'bulk requires pinned, addTags, removeTags or delete')
  }

  const result = await store.mutate((draft) => {
    const byId = new Map(draft.images.map((image) => [image.id, image]))
    for (const id of ids) {
      if (!byId.has(id)) throw notFoundImage(id)
    }
    if (remove) {
      const removeSet = new Set(ids)
      const before = draft.images.length
      draft.images = draft.images.filter((image) => !removeSet.has(image.id))
      return { updated: 0, removed: before - draft.images.length }
    }
    const dropTags = new Set(removeTags.map((tag) => tag.toLowerCase()))
    const now = new Date().toISOString()
    for (const id of ids) {
      const image = byId.get(id)
      if (pinned !== undefined) image.pinned = pinned
      if (addTags.length > 0) image.tags = normalizeTagList([...image.tags, ...addTags], false)
      if (dropTags.size > 0) image.tags = image.tags.filter((tag) => !dropTags.has(tag.toLowerCase()))
      image.updatedAt = now
    }
    return { updated: ids.length, removed: 0 }
  })

  sendJson(response, 200, { ok: true, updated: result.updated, removed: result.removed })
}

/** `POST /api/tags/merge` — rename or merge one tag across the whole board. */
async function handleMergeTags(store, request, response) {
  const body = await readJsonBody(request, MAX_PATCH_BODY_BYTES, 'invalid-body')
  const from = requireMergeTag(body.from, 'from')
  const to = requireMergeTag(body.to, 'to')
  if (from.toLowerCase() === to.toLowerCase()) {
    sendJson(response, 200, { ok: true, updated: 0 })
    return
  }

  let updated = 0
  await store.mutate((draft) => {
    const needle = from.toLowerCase()
    const now = new Date().toISOString()
    let touched = 0
    for (const image of draft.images) {
      if (!image.tags.some((tag) => tag.toLowerCase() === needle)) continue
      const next = []
      const seen = new Set()
      for (const tag of image.tags) {
        const value = tag.toLowerCase() === needle ? to : tag
        const key = value.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        next.push(value)
      }
      image.tags = next
      image.updatedAt = now
      touched += 1
    }
    updated = touched
  })

  sendJson(response, 200, { ok: true, updated })
}

/** `GET /image/<id>` — raw normalized bytes with immutable caching. */
async function handleImageBytes(store, ctx, response, id) {
  await store.ready()
  const image = store.current().images.find((entry) => entry.id === id)
  if (image === undefined) throw httpError('not-found', `no moodboard image has id "${id}"`)

  let data
  try {
    const result = await ctx.attachments.readImage(image.attachment)
    data = result?.data
  } catch (error) {
    const code = attachmentErrorCode(error)
    safeLog(ctx, 'warn', `moodboard: stored image is unavailable: ${code || safeMessage(error)}`)
    if (code === 'ATTACHMENT_NOT_FOUND') throw httpError('not-found', 'the stored image bytes are no longer available')
    throw httpError('storage-failed', 'the stored image bytes could not be read')
  }

  if (!(data instanceof Uint8Array) || data.byteLength === 0) {
    throw httpError('storage-failed', 'the stored image bytes could not be read')
  }
  sendImageBytes(response, data, image.attachment.mediaType)
}

/** Store one validated upload through the attachment service. */
async function saveImageBytes(ctx, upload) {
  const accepted = ctx.attachments?.imageLimits?.mediaTypes
  if (Array.isArray(accepted) && !accepted.includes(upload.mediaType)) {
    throw httpError('unsupported-media-type', `${upload.mediaType} images are not accepted by this deployment`)
  }
  try {
    return await ctx.attachments.saveImage({
      data: upload.bytes,
      mediaType: upload.mediaType,
      ...(upload.name === '' ? {} : { name: upload.name }),
    })
  } catch (error) {
    safeLog(ctx, 'warn', `moodboard: image was refused: ${attachmentErrorCode(error) || safeMessage(error)}`)
    throw mapAttachmentError(error)
  }
}

/** Map an AttachmentError to the contract HTTP error. */
function mapAttachmentError(error) {
  const code = attachmentErrorCode(error)
  switch (code) {
    case 'UNSUPPORTED_IMAGE_TYPE':
      return httpError('unsupported-media-type', 'the image media type is not accepted by this deployment')
    case 'IMAGE_TOO_LARGE':
    case 'IMAGES_TOO_LARGE':
    case 'TOO_MANY_IMAGES':
      return httpError('image-too-large', 'the image is too large to store')
    case 'INVALID_IMAGE':
    case 'INVALID_IMAGE_BASE64':
    case 'IMAGE_TYPE_MISMATCH':
      return httpError('invalid-image', 'the uploaded bytes are not a valid image of the declared media type')
    case 'IMAGE_DIMENSION_TOO_LARGE':
    case 'IMAGE_TOO_MANY_PIXELS':
      return httpError('invalid-image', 'the image dimensions exceed the deployment limits; downscale it and retry')
    default:
      return httpError('storage-failed', 'the image could not be stored')
  }
}

/** Stable attachment failure code, when present. */
function attachmentErrorCode(error) {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code
  return ''
}

/** `not-found` failure for an unknown image id. */
function notFoundImage(id) {
  return httpError('not-found', `no moodboard image has id "${id}"`)
}

// ---------------------------------------------------------------------------
// HTTP: request body + field validation
// ---------------------------------------------------------------------------

/** Read a bounded request body; oversized/garbled bodies fail with `overflowCode`. */
function readBody(request, limit, overflowCode) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    const fail = (error) => {
      finish(reject, error)
      if (typeof request.resume === 'function') request.resume()
    }
    request.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        fail(httpError(overflowCode, `the request body exceeds ${limit} bytes`))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (settled) return
      finish(resolve, Buffer.concat(chunks))
    })
    request.on('error', () => fail(httpError('invalid-body', 'the request body could not be read')))
    request.on('aborted', () => fail(httpError('invalid-body', 'the request was aborted')))
    request.on('close', () => fail(httpError('invalid-body', 'the request was closed before its body was read')))
    // A body already drained before this handler ran resolves as empty.
    if (request.readableEnded === true) finish(resolve, Buffer.alloc(0))
  })
}

/** Read and parse a bounded JSON object body. */
async function readJsonBody(request, limit, overflowCode) {
  const raw = await readBody(request, limit, overflowCode)
  if (raw.length === 0) throw httpError('invalid-body', 'the request body must be a JSON object')
  let parsed
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch {
    throw httpError('invalid-body', 'the request body is not valid JSON')
  }
  if (!isPlainObject(parsed)) throw httpError('invalid-body', 'the request body must be a JSON object')
  return parsed
}

/** Decode + validate `{ data, mediaType, name? }` from an upload body. */
function readImageUpload(body) {
  if (typeof body.data !== 'string') throw httpError('invalid-body', 'data must be a base64 string')
  const bytes = decodeBase64Image(body.data)
  const mediaType = readMediaType(body.mediaType)
  const name = body.name === undefined ? '' : requireName(body.name)
  return { bytes, mediaType, name }
}

/** Decode the standard-base64 image payload with the contract limits. */
function decodeBase64Image(value) {
  if (value.length === 0) throw httpError('image-too-large', 'the image payload is empty')
  if (value.length > MAX_IMAGE_BASE64_CHARS) {
    throw httpError('image-too-large', `the image payload exceeds ${MAX_IMAGE_BASE64_CHARS} base64 characters`)
  }
  if (value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    throw httpError('invalid-image', 'data must be standard base64 without a data-URL prefix')
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length === 0) throw httpError('image-too-large', 'the image payload is empty')
  if (decoded.toString('base64') !== value) {
    throw httpError('invalid-image', 'data must be canonical standard base64 without a data-URL prefix')
  }
  return new Uint8Array(decoded)
}

/** Validate one of the four accepted image media types. */
function readMediaType(value) {
  if (typeof value !== 'string') {
    throw httpError('unsupported-media-type', 'mediaType must be one of image/png, image/jpeg, image/webp, image/gif')
  }
  const mediaType = value.trim().toLowerCase()
  if (!IMAGE_MEDIA_TYPE_SET.has(mediaType)) {
    throw httpError('unsupported-media-type', 'mediaType must be one of image/png, image/jpeg, image/webp, image/gif')
  }
  return mediaType
}

/** Optional `tags` field: absent → `[]`, present → validated array. */
function readOptionalTags(body) {
  if (!Object.hasOwn(body, 'tags')) return []
  return requireTags(body.tags)
}

/** Optional `notes` field: absent → `''`, present → bounded string. */
function readOptionalNotes(body) {
  if (!Object.hasOwn(body, 'notes')) return ''
  return requireNotes(body.notes)
}

/** Optional `sourceUrl` field: absent → `''`, present → normalized URL or `''`. */
function readOptionalSourceUrl(body) {
  if (!Object.hasOwn(body, 'sourceUrl')) return ''
  return requireSourceUrl(body.sourceUrl)
}

/** Validate a `tags` value. */
function requireTags(value) {
  if (!Array.isArray(value)) throw httpError('invalid-body', 'tags must be an array of strings')
  return normalizeTagList(value, true)
}

/** Validate a `notes` value. */
function requireNotes(value) {
  if (typeof value !== 'string') throw httpError('invalid-body', 'notes must be a string')
  return value.slice(0, MAX_NOTES_CHARS)
}

/** Validate a `name` value. */
function requireName(value) {
  if (typeof value !== 'string') throw httpError('invalid-body', 'name must be a string')
  return sanitizeName(value) || 'image'
}

/** Validate a `sourceUrl` value; non-http(s) values are stored as `''`. */
function requireSourceUrl(value) {
  if (typeof value !== 'string') throw httpError('invalid-body', 'sourceUrl must be a string')
  return normalizeSourceUrl(value)
}

/** Validate a `pinned` value. */
function requirePinned(value) {
  if (typeof value !== 'boolean') throw httpError('invalid-body', 'pinned must be a boolean')
  return value
}

/** Validate an `order` value. */
function requireOrder(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw httpError('invalid-body', 'order must be a non-negative integer')
  return value
}

/** Validate an id list for reorder/bulk: 1..MAX_IMAGES valid, unique image ids. */
function requireIdList(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_IMAGES) {
    throw httpError('invalid-body', `ids must be an array of 1 through ${MAX_IMAGES} image ids`)
  }
  const ids = []
  const seen = new Set()
  for (const id of value) {
    if (typeof id !== 'string' || !IMAGE_ID_PATTERN.test(id)) {
      throw httpError('invalid-body', 'ids must be moodboard image ids')
    }
    if (seen.has(id)) throw httpError('invalid-body', 'ids must not contain duplicates')
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/** Validate an optional `delete` flag for a bulk operation. */
function requireDeleteFlag(value) {
  if (typeof value !== 'boolean') throw httpError('invalid-body', 'delete must be a boolean')
  return value
}

/** Validate a tag name for the tag merge endpoint. */
function requireMergeTag(value, field) {
  if (typeof value !== 'string') throw httpError('invalid-body', `${field} must be a string`)
  const tag = value.trim().slice(0, MAX_TAG_CHARS)
  if (tag === '') throw httpError('invalid-body', `${field} must be a non-empty tag`)
  return tag
}

/** Read a PATCH body into a validated patch object (at least one known field). */
function readImagePatch(body) {
  const patch = {}
  let touched = false
  if (Object.hasOwn(body, 'name')) {
    patch.name = requireName(body.name)
    touched = true
  }
  if (Object.hasOwn(body, 'tags')) {
    patch.tags = requireTags(body.tags)
    touched = true
  }
  if (Object.hasOwn(body, 'notes')) {
    patch.notes = requireNotes(body.notes)
    touched = true
  }
  if (Object.hasOwn(body, 'sourceUrl')) {
    patch.sourceUrl = requireSourceUrl(body.sourceUrl)
    touched = true
  }
  if (Object.hasOwn(body, 'pinned')) {
    patch.pinned = requirePinned(body.pinned)
    touched = true
  }
  if (Object.hasOwn(body, 'order')) {
    patch.order = requireOrder(body.order)
    touched = true
  }
  if (!touched) {
    throw httpError('invalid-body', 'PATCH requires at least one of name, tags, notes, sourceUrl, pinned, order')
  }
  return patch
}

/** `?tag=...` (repeated) → trimmed tag filters. */
function readQueryTags(url) {
  const rawTags = url.searchParams.getAll('tag')
  if (rawTags.length > MAX_TAGS) throw httpError('invalid-query', `at most ${MAX_TAGS} tag filters are allowed`)
  const tags = []
  for (const value of rawTags) {
    const tag = value.trim().slice(0, MAX_TAG_CHARS)
    if (tag !== '') tags.push(tag)
  }
  return normalizeTagList(tags, false)
}

/** `?match=any|all` */
function readQueryMatch(url) {
  const value = url.searchParams.get('match')
  if (value === null || value === '') return 'any'
  if (value !== 'any' && value !== 'all') throw httpError('invalid-query', 'match must be "any" or "all"')
  return value
}

/** `?limit=<1..200>` */
function readQueryLimit(url) {
  const value = url.searchParams.get('limit')
  if (value === null || value === '') return DEFAULT_QUERY_LIMIT
  if (!/^\d+$/u.test(value)) throw httpError('invalid-query', 'limit must be an integer')
  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_QUERY_LIMIT) {
    throw httpError('invalid-query', `limit must be an integer from 1 through ${MAX_QUERY_LIMIT}`)
  }
  return limit
}

// ---------------------------------------------------------------------------
// Field normalization
// ---------------------------------------------------------------------------

/** Trimmed, de-duplicated (case-insensitive), capped tag list. */
function normalizeTagList(values, strict) {
  const tags = []
  const seen = new Set()
  for (const value of values) {
    if (typeof value !== 'string') {
      if (strict) throw httpError('invalid-body', 'tags must be an array of strings')
      continue
    }
    const tag = value.trim().slice(0, MAX_TAG_CHARS)
    if (tag === '') continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length >= MAX_TAGS) break
  }
  return tags
}

/** Collapse whitespace and cap a display name. */
function sanitizeName(value) {
  if (typeof value !== 'string') return ''
  return collapseWhitespace(value).slice(0, MAX_NAME_CHARS)
}

/** Accept only http(s) source URLs; anything else is stored as `''`. */
function normalizeSourceUrl(value) {
  const trimmed = collapseWhitespace(value).slice(0, MAX_SOURCE_URL_CHARS)
  if (trimmed === '') return ''
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : ''
  } catch {
    return ''
  }
}

/** Lenient source URL normalizer for values read back from disk. */
function normalizeStoredSourceUrl(value) {
  return typeof value === 'string' ? normalizeSourceUrl(value) : ''
}

/** Collapse runs of whitespace to single spaces. */
function collapseWhitespace(value) {
  return value.replace(/\s+/gu, ' ').trim()
}

/** Is this a plain JSON object (not null, array, or exotic prototype)? */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// ---------------------------------------------------------------------------
// Board mutations
// ---------------------------------------------------------------------------

/** New random image id: `mb_` + 12 lowercase hex chars. */
function newImageId() {
  return `mb_${randomBytes(6).toString('hex')}`
}

/** Allocate the next free gallery order. */
function nextImageOrder(draft) {
  let order = Number.isSafeInteger(draft.nextOrder) && draft.nextOrder >= 0 ? draft.nextOrder : draft.images.length
  const used = new Set(draft.images.map((image) => image.order))
  while (used.has(order)) order += 1
  draft.nextOrder = order + 1
  return order
}

/** Append one freshly uploaded image to the draft. */
function createImageEntry(draft, input) {
  const now = new Date().toISOString()
  let id = newImageId()
  while (draft.images.some((image) => image.id === id)) id = newImageId()
  const image = {
    id,
    name: input.name !== '' ? input.name : sanitizeName(input.ref.name) || 'image',
    attachment: { ...input.ref },
    tags: input.tags,
    notes: input.notes,
    sourceUrl: input.sourceUrl,
    pinned: false,
    order: nextImageOrder(draft),
    createdAt: now,
    updatedAt: now,
  }
  draft.images.push(image)
  return image
}

/** Apply a validated PATCH to one image. */
function applyImagePatch(draft, image, patch) {
  if (patch.name !== undefined) image.name = patch.name
  if (patch.tags !== undefined) image.tags = patch.tags
  if (patch.notes !== undefined) image.notes = patch.notes
  if (patch.sourceUrl !== undefined) image.sourceUrl = patch.sourceUrl
  if (patch.pinned !== undefined) image.pinned = patch.pinned
  if (patch.order !== undefined) {
    image.order = patch.order
    if (!Number.isSafeInteger(draft.nextOrder) || draft.nextOrder <= patch.order) draft.nextOrder = patch.order + 1
  }
  image.updatedAt = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Views, sorting, briefs
// ---------------------------------------------------------------------------

/** Canonical ordering: pinned first, then order, then createdAt, then id. */
function compareImages(left, right) {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
  if (left.order !== right.order) return left.order - right.order
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1
  if (left.id === right.id) return 0
  return left.id < right.id ? -1 : 1
}

/** Sorted copy of the board images. */
function sortImages(images) {
  return [...images].sort(compareImages)
}

/** HTTP ImageView for one stored image. */
function imageView(image) {
  const attachment = image.attachment
  return {
    id: image.id,
    name: image.name,
    tags: [...image.tags],
    notes: image.notes,
    sourceUrl: image.sourceUrl,
    pinned: image.pinned,
    order: image.order,
    createdAt: image.createdAt,
    updatedAt: image.updatedAt,
    mediaType: attachment.mediaType,
    bytes: attachment.bytes,
    width: attachment.width,
    height: attachment.height,
    imageUrl: `${PREFIX}/image/${image.id}`,
  }
}

/** HTTP BoardView for the whole board. */
function boardView(board) {
  const ordered = sortImages(board.images)
  const tags = collectTags(board.images)
  return {
    version: board.version,
    updatedAt: board.updatedAt,
    images: ordered.map(imageView),
    allTags: tags.allTags,
    tagCounts: tags.tagCounts,
    pinned: ordered.filter((image) => image.pinned).map((image) => image.id),
  }
}

/** Case-insensitive tag inventory with per-tag image counts. */
function collectTags(images) {
  const byKey = new Map()
  for (const image of images) {
    for (const tag of image.tags) {
      const key = tag.toLowerCase()
      const entry = byKey.get(key)
      if (entry === undefined) byKey.set(key, { tag, count: 1 })
      else entry.count += 1
    }
  }
  const entries = [...byKey.values()].sort((left, right) => left.tag.localeCompare(right.tag, 'en'))
  return {
    allTags: entries.map((entry) => entry.tag),
    tagCounts: Object.fromEntries(entries.map((entry) => [entry.tag, entry.count])),
  }
}

/** Whether one image matches the tag filter. */
function matchesTags(image, tags, match) {
  if (tags.length === 0) return true
  const imageTags = new Set(image.tags.map((tag) => tag.toLowerCase()))
  const wanted = tags.map((tag) => tag.toLowerCase())
  return match === 'all' ? wanted.every((tag) => imageTags.has(tag)) : wanted.some((tag) => imageTags.has(tag))
}

/** Short plain-text style brief (never HTML) for the model and the client. */
function buildBrief(images, mode, totalCount = images.length) {
  if (totalCount === 0) return EMPTY_BRIEF
  const shown = images.slice(0, MAX_BRIEF_LINES)
  const lines = shown.map((image, index) => briefLine(image, index))
  const omitted = totalCount - shown.length
  if (omitted > 0) lines.push(`…and ${omitted} more reference image${omitted === 1 ? '' : 's'}.`)
  return `${briefHeader(mode, totalCount)}\n${lines.join('\n')}`
}

/** Header line for a brief. */
function briefHeader(mode, count) {
  const plural = count === 1 ? '' : 's'
  switch (mode) {
    case 'pinned':
      return `Active moodboard style guide (${count} pinned reference${plural}):`
    case 'fallback':
      return `Active moodboard style guide (${count} reference${plural}; none pinned, so the whole board is the guide):`
    case 'query':
      return `Moodboard reference images matching the requested tags (${count}):`
    case 'get':
      return 'Moodboard reference image:'
    default:
      return `Moodboard reference images (${count}):`
  }
}

/** One brief line: name, tags, notes, source, capped at 400 chars. */
function briefLine(image, index) {
  const parts = [`tags: ${image.tags.length > 0 ? image.tags.join(', ') : 'none'}`]
  if (image.notes !== '') parts.push(`notes: ${collapseWhitespace(image.notes)}`)
  if (image.sourceUrl !== '') parts.push(`source: ${image.sourceUrl}`)
  return clipText(`${index + 1}. ${image.name} — ${parts.join('; ')}`, MAX_BRIEF_LINE_CHARS)
}

/** Clip a string to a maximum length, appending an ellipsis when cut. */
function clipText(value, maxChars) {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars - 1).trimEnd()}…`
}

// ---------------------------------------------------------------------------
// System prompt section
// ---------------------------------------------------------------------------

/**
 * Dynamic `moodboard:style-guide` text. Returns `''` when the board has no
 * images (empty sections are dropped by the prompt assembler).
 */
function styleGuideSectionText(store) {
  if (!store.isLoaded()) return ''
  const board = store.current()
  if (board.images.length === 0) return ''

  const ordered = sortImages(board.images)
  const pinned = ordered.filter((image) => image.pinned)
  const references = (pinned.length > 0 ? pinned : ordered).slice(0, 5)
  const count = board.images.length
  const noun = count === 1 ? 'image' : 'images'
  const intro =
    pinned.length > 0
      ? `The user maintains a design moodboard with ${count} reference ${noun}; ${pinned.length} ${pinned.length === 1 ? 'is' : 'are'} pinned as the active style guide:`
      : `The user maintains a design moodboard with ${count} reference ${noun} (none pinned, so the whole board is the active style guide):`

  const referenceLines = references.map((image, index) => {
    const tags = image.tags.slice(0, 4).map((tag) => clipText(tag, 24))
    const suffix = tags.length > 0 ? ` — tags: ${tags.join(', ')}` : ''
    return `${index + 1}. ${clipText(image.name, 72)}${suffix}`
  })

  const instruction =
    'Before generating or changing app UI, call the `moodboard` tool with `action: "active"` to load the reference images, then match their typography, color palette, spacing, radius, iconography and component styling exactly.'
  const queryHint = 'For a tag-specific subset, call the same tool with `action: "query"` and the relevant tags.'

  const head = `## Design moodboard\n\n${intro}`
  const tail = `${instruction}\n\n${queryHint}`
  let body = ''
  for (const line of referenceLines) {
    const candidate = body === '' ? line : `${body}\n${line}`
    if (`${head}\n\n${candidate}\n\n${tail}`.length > MAX_SECTION_CHARS) break
    body = candidate
  }
  const text = body === '' ? `${head}\n\n${tail}` : `${head}\n\n${body}\n\n${tail}`
  return clipText(text, MAX_SECTION_CHARS)
}

// ---------------------------------------------------------------------------
// Agent tool
// ---------------------------------------------------------------------------

/** Output-schema fragment for the durable attachment reference. */
const ATTACHMENT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string', description: 'Durable attachment id.' },
    mediaType: { type: 'string', enum: [...IMAGE_MEDIA_TYPES] },
    bytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    name: { type: 'string' },
    originalDimensions: {
      type: 'object',
      additionalProperties: false,
      properties: { width: { type: 'integer' }, height: { type: 'integer' } },
      required: ['width', 'height'],
    },
  },
  required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
}

/** Output-schema fragment for one moodboard image. */
const TOOL_IMAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    sourceUrl: { type: 'string' },
    pinned: { type: 'boolean' },
    mediaType: { type: 'string', enum: [...IMAGE_MEDIA_TYPES] },
    bytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    attachment: ATTACHMENT_VALUE_SCHEMA,
  },
  required: ['id', 'name', 'tags', 'notes', 'sourceUrl', 'pinned', 'mediaType', 'bytes', 'width', 'height', 'attachment'],
}

/** Model-facing tool value schema. */
const TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    action: { type: 'string', enum: [...TOOL_ACTIONS] },
    brief: { type: 'string' },
    images: { type: 'array', items: TOOL_IMAGE_SCHEMA },
    total: { type: 'integer' },
    fallback: { type: 'boolean' },
    error: {
      type: 'object',
      additionalProperties: false,
      properties: { code: { type: 'string' }, message: { type: 'string' } },
      required: ['code', 'message'],
    },
  },
  required: ['ok', 'action', 'brief', 'images', 'total', 'fallback'],
}

/** Build the `moodboard` tool definition bound to one board store. */
function createMoodboardTool(store) {
  return {
    name: 'moodboard',
    description:
      "The user's moodboard of visual reference images. Returns the active style guide (pinned images, or the whole board when none are pinned) with names, tags, notes and the reference images themselves. Use `active` before generating or changing app UI and match the references' typography, color palette, spacing, radius, iconography and component styling exactly. `query` filters by tags, `get` returns one image by id, `list` returns every image's metadata as text, and `brief` returns only the text style brief.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: [...TOOL_ACTIONS],
          description: 'Which view to return. Defaults to "active".',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to filter by when action is "query"; case-insensitive.',
        },
        match: {
          type: 'string',
          enum: ['any', 'all'],
          description: 'Tag matching for "query": "any" keeps images with at least one tag, "all" requires every tag. Defaults to "any".',
        },
        id: {
          type: 'string',
          description: 'Image id (mb_…) to load when action is "get".',
        },
        includeImages: {
          type: 'boolean',
          description: 'Attach the reference images themselves. Defaults to true for active/query/get and false for list/brief.',
        },
      },
      required: [],
    },
    output: {
      schema: TOOL_OUTPUT_SCHEMA,
      render: (args, value) => renderToolContent(args, value),
      presentationMeta: (_args, value) => ({
        action: value.action,
        total: value.total,
        fallback: value.fallback,
      }),
    },
    async execute(args) {
      return executeMoodboard(store, args)
    },
    presentCall(args) {
      const action = isPlainObject(args) && typeof args.action === 'string' ? args.action : 'active'
      return { card: 'generic', title: `Moodboard: ${action}`, kind: 'read' }
    },
    isConcurrencySafe: () => true,
  }
}

/** Validate tool args and build the tool value. */
async function executeMoodboard(store, rawArgs) {
  const args = isPlainObject(rawArgs) ? rawArgs : {}
  const action = args.action === undefined ? 'active' : args.action
  if (typeof action !== 'string' || !TOOL_ACTION_SET.has(action)) {
    throw new Error(`moodboard: action must be one of ${TOOL_ACTIONS.join(', ')}`)
  }

  let tags = []
  if (args.tags !== undefined) {
    if (!Array.isArray(args.tags) || args.tags.some((tag) => typeof tag !== 'string')) {
      throw new Error('moodboard: tags must be an array of strings')
    }
    tags = normalizeTagList(args.tags, false)
  }

  let match = 'any'
  if (args.match !== undefined) {
    if (args.match !== 'any' && args.match !== 'all') throw new Error('moodboard: match must be "any" or "all"')
    match = args.match
  }

  if (args.includeImages !== undefined && typeof args.includeImages !== 'boolean') {
    throw new Error('moodboard: includeImages must be a boolean')
  }

  let id = ''
  if (action === 'get') {
    if (typeof args.id !== 'string' || args.id.trim() === '') throw new Error('moodboard: id is required for action "get"')
    id = args.id.trim()
  }

  await store.ready()
  const ordered = sortImages(store.current().images)

  if (action === 'get') {
    const image = ordered.find((entry) => entry.id === id)
    if (image === undefined) {
      return {
        ok: false,
        action: 'get',
        brief: '',
        images: [],
        total: 0,
        fallback: false,
        error: { code: 'not-found', message: `not found: no moodboard image has id "${id}"` },
      }
    }
    return {
      ok: true,
      action,
      brief: buildBrief([image], 'get', 1),
      images: [toolImage(image)],
      total: 1,
      fallback: false,
    }
  }

  if (action === 'list') {
    return {
      ok: true,
      action,
      brief: ordered.length === 0 ? EMPTY_BRIEF : `${ordered.length} image${ordered.length === 1 ? '' : 's'} on the moodboard.`,
      images: ordered.map(toolImage),
      total: ordered.length,
      fallback: false,
    }
  }

  if (action === 'active' || action === 'brief') {
    const pinned = ordered.filter((image) => image.pinned)
    const fallback = pinned.length === 0
    const selection = fallback ? ordered : pinned
    const brief = buildBrief(selection, fallback ? 'fallback' : 'pinned')
    return {
      ok: true,
      action,
      brief,
      images: action === 'brief' ? [] : selection.map(toolImage),
      total: selection.length,
      fallback,
    }
  }

  const matches = ordered.filter((image) => matchesTags(image, tags, match))
  return {
    ok: true,
    action: 'query',
    brief: buildBrief(matches, tags.length > 0 ? 'query' : 'all', matches.length),
    images: matches.map(toolImage),
    total: matches.length,
    fallback: false,
  }
}

/** Tool-value projection of one image, including the full attachment ref. */
function toolImage(image) {
  const attachment = image.attachment
  return {
    id: image.id,
    name: image.name,
    tags: [...image.tags],
    notes: image.notes,
    sourceUrl: image.sourceUrl,
    pinned: image.pinned,
    mediaType: attachment.mediaType,
    bytes: attachment.bytes,
    width: attachment.width,
    height: attachment.height,
    attachment: attachmentValue(attachment),
  }
}

/** The exact normalized reference an image content block carries. */
function attachmentValue(attachment) {
  return {
    attachmentId: attachment.attachmentId,
    mediaType: attachment.mediaType,
    bytes: attachment.bytes,
    width: attachment.width,
    height: attachment.height,
    ...(typeof attachment.name === 'string' ? { name: attachment.name } : {}),
    ...(attachment.originalDimensions !== undefined
      ? { originalDimensions: { width: attachment.originalDimensions.width, height: attachment.originalDimensions.height } }
      : {}),
  }
}

/** Build the model-facing content blocks: text first, then real image blocks. */
function renderToolContent(args, value) {
  if (value.ok !== true) {
    const message = value.error !== undefined ? value.error.message : 'the request failed'
    return [{ type: 'text', text: `Moodboard ${value.action}: ${message}` }]
  }

  if (value.action === 'list') return [{ type: 'text', text: renderListText(value) }]

  const blocks = [{ type: 'text', text: value.brief }]
  if (wantsImageBlocks(args, value.action)) {
    const selected = value.images.slice(0, MAX_TOOL_IMAGE_BLOCKS)
    for (const image of selected) blocks.push({ type: 'image', attachment: attachmentValue(image.attachment) })
    const omitted = value.images.length - selected.length
    if (omitted > 0) {
      blocks.push({
        type: 'text',
        text: `${omitted} more reference image${omitted === 1 ? '' : 's'} were not attached (max ${MAX_TOOL_IMAGE_BLOCKS} per call). Use action="query" with tags to narrow the selection, or action="get" with an id for one image.`,
      })
    }
  }
  return blocks
}

/** Whether this call emits image content blocks. */
function wantsImageBlocks(args, action) {
  if (action === 'list' || action === 'brief') return false
  const includeImages = isPlainObject(args) ? args.includeImages : undefined
  if (typeof includeImages === 'boolean') return includeImages
  return true
}

/** Text-only rendering for `action: "list"`. */
function renderListText(value) {
  if (value.total === 0) return EMPTY_BRIEF
  const lines = value.images.map((image, index) => {
    const flags = image.pinned ? ' [pinned]' : ''
    const tags = image.tags.length > 0 ? image.tags.join(', ') : 'none'
    const notes = image.notes !== '' ? `; notes: ${collapseWhitespace(image.notes)}` : ''
    const source = image.sourceUrl !== '' ? `; source: ${image.sourceUrl}` : ''
    const line = `${index + 1}. ${image.name}${flags} (id: ${image.id}) — tags: ${tags}; ${image.mediaType}, ${image.width}x${image.height}, ${image.bytes} bytes${notes}${source}`
    return clipText(line, MAX_BRIEF_LINE_CHARS * 2)
  })
  return `All ${value.total} moodboard image${value.total === 1 ? '' : 's'}:\n${lines.join('\n')}`
}

// ---------------------------------------------------------------------------
// HTTP response writers
// ---------------------------------------------------------------------------

/** Write one JSON response with the contract envelope. */
function sendJson(response, status, payload) {
  if (response.writableEnded === true || response.headersSent === true) return
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
  })
  response.end(body)
}

/** Write one JSON error envelope. */
function sendJsonError(response, code, message) {
  sendJson(response, ERROR_STATUS[code] ?? 500, { ok: false, error: { code, message } })
}

/** Write raw normalized image bytes with immutable caching. */
function sendImageBytes(response, data, mediaType) {
  if (response.writableEnded === true || response.headersSent === true) return
  response.writeHead(200, {
    'content-type': mediaType,
    'content-length': String(data.byteLength),
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  })
  response.end(data)
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/** Safe error message text (never includes image bytes, base64, or notes). */
function safeMessage(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 200 ? `${message.slice(0, 200)}…` : message
}

/** Best-effort logging that can never break a request. */
function safeLog(ctx, level, message) {
  try {
    const logger = ctx.logger
    const write = logger !== undefined && typeof logger[level] === 'function' ? logger[level] : undefined
    if (write !== undefined) write.call(logger, message)
  } catch {
    // Logging is best effort only.
  }
}
