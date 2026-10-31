/**
 * host-stub.js — minimal DSH host emulation for the real-render harness.
 *
 * Provides:
 *   - window.__ModuleLoader__.load(), the loader contract client.js expects;
 *   - a `react` require resolving to mini-react.js;
 *   - a real fetch-backed stub for /moodboard/api/* + /moodboard/image/<id>,
 *     serving fixture JSON from fixture-board.js and image bytes from
 *     verification/harness/fixtures (through the static server);
 *   - ctx with locale (the module's own en dictionary), effect runner and
 *     capturing slots.inject/register.
 *
 * Nothing here re-implements UI: the plugin's own factory, apply() and
 * components run unchanged.
 */
;(function () {
  'use strict'

  window.__HARNESS_ERRORS__ = []
  window.addEventListener('error', (event) => {
    window.__HARNESS_ERRORS__.push(event.error !== undefined ? event.error : event.message)
  })
  window.addEventListener('unhandledrejection', (event) => {
    window.__HARNESS_ERRORS__.push(event.reason)
  })

  const fixture = window.HARNESS_FIXTURE
  const params = new URLSearchParams(window.location.search)
  const boardMode = params.get('board') || 'default'

  const clone = (value) => JSON.parse(JSON.stringify(value))
  const board = clone(fixture.board)
  if (boardMode === 'empty') {
    board.images = []
    board.allTags = []
    board.tagCounts = {}
    board.updatedAt = null
  }
  const files = Object.assign({}, fixture.files)
  let revision = fixture.revision
  let updatedAt = board.updatedAt

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const nativeFetch = window.fetch.bind(window)

  function json(payload, status) {
    return new Response(JSON.stringify(payload), {
      status: status === undefined ? 200 : status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }

  function failure(code, message, status) {
    return json({ ok: false, error: { code, message } }, status)
  }

  function boardView() {
    return {
      version: board.version,
      updatedAt,
      images: board.images.map((entry) => toImageView(entry)),
      allTags: board.allTags.slice(),
      tagCounts: Object.assign({}, board.tagCounts),
      pinned: board.images.filter((entry) => entry.pinned).map((entry) => entry.id),
    }
  }

  function toImageView(entry) {
    return {
      id: entry.id,
      name: entry.name,
      tags: entry.tags.slice(),
      notes: entry.notes,
      sourceUrl: entry.sourceUrl,
      pinned: entry.pinned,
      order: entry.order,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      mediaType: entry.mediaType,
      bytes: entry.bytes,
      width: entry.width,
      height: entry.height,
      imageUrl: `/moodboard/image/${entry.id}`,
    }
  }

  function rebuildTags() {
    const counts = {}
    const all = []
    for (const entry of board.images) {
      for (const tag of entry.tags) {
        if (counts[tag] === undefined) {
          counts[tag] = 0
          all.push(tag)
        }
        counts[tag] += 1
      }
    }
    board.allTags = all
    board.tagCounts = counts
  }

  function bump() {
    revision += 1
    updatedAt = new Date(Date.now()).toISOString()
    board.updatedAt = updatedAt
  }

  function findImage(id) {
    return board.images.find((entry) => entry.id === id) || null
  }

  function normalizeTags(input) {
    const tags = []
    if (!Array.isArray(input)) return tags
    for (const tag of input) {
      if (typeof tag !== 'string') continue
      const trimmed = tag.trim()
      if (trimmed === '') continue
      if (tags.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) continue
      tags.push(trimmed)
      if (tags.length >= 20) break
    }
    return tags
  }

  async function handleApi(url, init) {
    const method = (init !== undefined && init.method) || 'GET'
    const path = url.pathname
    let body = null
    if (typeof (init === undefined ? undefined : init.body) === 'string' && init.body !== '') {
      try {
        body = JSON.parse(init.body)
      } catch (error) {
        return failure('invalid-body', 'Body is not valid JSON.', 400)
      }
    }
    // A little latency keeps loading states honest without slowing captures.
    await sleep(20)

    if (method === 'GET' && path === '/moodboard/api/state') {
      return json({ ok: true, revision, board: boardView() })
    }
    if (method === 'GET' && path === '/moodboard/api/revision') {
      return json({ ok: true, revision, updatedAt, images: board.images.length })
    }
    if (method === 'GET' && path === '/moodboard/api/health') {
      return json({ ok: true, version: 1, images: board.images.length })
    }
    if (method === 'GET' && path === '/moodboard/api/sources') {
      return json(fixture.sources)
    }
    if (method === 'GET' && path === '/moodboard/api/active') {
      const pinned = board.images.filter((entry) => entry.pinned)
      const selected = pinned.length > 0 ? pinned : board.images
      return json({
        ok: true,
        guide: {
          images: selected.map(toImageView),
          allTags: board.allTags.slice(),
          tagCounts: Object.assign({}, board.tagCounts),
          fallback: pinned.length === 0,
        },
        brief:
          selected.length === 0
            ? 'The moodboard is empty.'
            : `Active moodboard style guide (${selected.length} references):\n` +
              selected
                .map((entry, index) => `${index + 1}. ${entry.name} — tags: ${entry.tags.join(', ')}`)
                .join('\n'),
      })
    }
    if (method === 'GET' && path === '/moodboard/api/query') {
      const tags = url.searchParams.getAll('tag')
      const match = url.searchParams.get('match') || 'any'
      const limit = Number.parseInt(url.searchParams.get('limit') || '50', 10)
      let rows = board.images.filter((entry) => {
        if (tags.length === 0) return true
        const lowered = entry.tags.map((tag) => tag.toLowerCase())
        const hits = tags.filter((tag) => lowered.indexOf(tag.toLowerCase()) !== -1).length
        return match === 'all' ? hits === tags.length : hits > 0
      })
      if (Number.isFinite(limit)) rows = rows.slice(0, limit)
      return json({ ok: true, images: rows.map(toImageView), brief: '', total: rows.length })
    }
    if (method === 'POST' && path === '/moodboard/api/images') {
      const id = `mb_${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`
      const entry = {
        id,
        name: typeof body?.name === 'string' && body.name !== '' ? body.name : 'image',
        tags: normalizeTags(body?.tags),
        notes: typeof body?.notes === 'string' ? body.notes : '',
        sourceUrl: typeof body?.sourceUrl === 'string' ? body.sourceUrl : '',
        pinned: body?.pinned === true,
        order: board.images.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        mediaType: typeof body?.mediaType === 'string' ? body.mediaType : 'image/png',
        bytes: 0,
        width: 900,
        height: 675,
      }
      board.images.push(entry)
      files[id] = 'fixtures/reference-harness-light.jpg'
      rebuildTags()
      bump()
      return json({ ok: true, image: toImageView(entry) })
    }
    const patchMatch = /^\/moodboard\/api\/images\/([^/]+)$/.exec(path)
    if (method === 'PATCH' && patchMatch !== null) {
      const entry = findImage(decodeURIComponent(patchMatch[1]))
      if (entry === null) return failure('not-found', 'Image not found.', 404)
      if (typeof body?.name === 'string') entry.name = body.name.slice(0, 200)
      if (Array.isArray(body?.tags)) entry.tags = normalizeTags(body.tags)
      if (typeof body?.notes === 'string') entry.notes = body.notes
      if (typeof body?.sourceUrl === 'string') entry.sourceUrl = body.sourceUrl
      if (typeof body?.pinned === 'boolean') entry.pinned = body.pinned
      if (Number.isFinite(body?.order)) entry.order = body.order
      entry.updatedAt = new Date().toISOString()
      rebuildTags()
      bump()
      return json({ ok: true, image: toImageView(entry) })
    }
    if (method === 'DELETE' && patchMatch !== null) {
      const id = decodeURIComponent(patchMatch[1])
      const index = board.images.findIndex((entry) => entry.id === id)
      if (index === -1) return failure('not-found', 'Image not found.', 404)
      board.images.splice(index, 1)
      delete files[id]
      rebuildTags()
      bump()
      return json({ ok: true, removed: id })
    }
    if (method === 'POST' && path === '/moodboard/api/images/reorder') {
      const ids = Array.isArray(body?.ids) ? body.ids : []
      if (ids.length !== board.images.length) return failure('invalid-body', 'Reorder needs every image id.', 400)
      const byId = new Map(board.images.map((entry) => [entry.id, entry]))
      board.images = ids.map((id, index) => {
        const entry = byId.get(id)
        if (entry === undefined) throw new Error(`unknown image ${id}`)
        entry.order = index
        return entry
      })
      bump()
      return json({ ok: true })
    }
    if (method === 'POST' && path === '/moodboard/api/images/bulk') {
      const ids = Array.isArray(body?.ids) ? body.ids : []
      let updated = 0
      let removed = 0
      if (body?.delete === true) {
        const before = board.images.length
        board.images = board.images.filter((entry) => ids.indexOf(entry.id) === -1)
        removed = before - board.images.length
      } else {
        for (const id of ids) {
          const entry = findImage(id)
          if (entry === null) continue
          if (typeof body?.pinned === 'boolean') entry.pinned = body.pinned
          if (Array.isArray(body?.addTags)) entry.tags = normalizeTags(entry.tags.concat(body.addTags))
          if (Array.isArray(body?.removeTags)) {
            const drop = new Set(body.removeTags.map((tag) => String(tag).toLowerCase()))
            entry.tags = entry.tags.filter((tag) => !drop.has(tag.toLowerCase()))
          }
          entry.updatedAt = new Date().toISOString()
          updated += 1
        }
      }
      rebuildTags()
      bump()
      return json({ ok: true, updated, removed })
    }
    if (method === 'POST' && path === '/moodboard/api/tags/merge') {
      const from = typeof body?.from === 'string' ? body.from.trim() : ''
      const to = typeof body?.to === 'string' ? body.to.trim() : ''
      let updated = 0
      if (from !== '' && to !== '') {
        for (const entry of board.images) {
          const next = []
          for (const tag of entry.tags) {
            const value = tag.toLowerCase() === from.toLowerCase() ? to : tag
            if (!next.some((existing) => existing.toLowerCase() === value.toLowerCase())) next.push(value)
          }
          if (JSON.stringify(next) !== JSON.stringify(entry.tags)) {
            entry.tags = next
            updated += 1
          }
        }
      }
      rebuildTags()
      bump()
      return json({ ok: true, updated })
    }
    if (method === 'POST' && path === '/moodboard/api/import') {
      // Deterministic, additive result: one imported reference, one duplicate,
      // one failure — enough to exercise the result summary UI.
      const tagList = normalizeTags(body?.tags)
      const id = `mb_${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`
      const entry = {
        id,
        name: 'imported-reference.jpg',
        tags: tagList.length > 0 ? tagList : ['imported'],
        notes: 'Imported by the harness stub during a dialog render check.',
        sourceUrl: 'https://example.com/imported-reference',
        pinned: body?.pinned === true,
        order: board.images.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        mediaType: 'image/jpeg',
        bytes: 0,
        width: 900,
        height: 675,
      }
      board.images.push(entry)
      files[id] = 'fixtures/reference-intake.jpg'
      rebuildTags()
      bump()
      return json({
        ok: true,
        imported: [toImageView(entry)],
        duplicates: [],
        failures: [{ input: 'https://example.com/broken', code: 'upstream-error', message: 'The page did not expose an image preview.' }],
      })
    }
    return failure('not-found', `No stub route for ${method} ${path}.`, 404)
  }

  async function stubFetch(input, init) {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(rawUrl, window.location.href)
    if (url.pathname.indexOf('/moodboard/api') === 0) {
      try {
        return await handleApi(url, init)
      } catch (error) {
        window.__HARNESS_ERRORS__.push(error)
        return failure('storage-failed', String(error && error.message ? error.message : error), 500)
      }
    }
    if (url.pathname.indexOf('/moodboard/image/') === 0) {
      const id = decodeURIComponent(url.pathname.slice('/moodboard/image/'.length))
      const file = files[id]
      if (file === undefined) return failure('not-found', 'Image not found.', 404)
      return nativeFetch(new URL(file, window.location.href).href)
    }
    return nativeFetch(input, init)
  }
  window.fetch = stubFetch

  // ---------------------------------------------------------------------------
  // DSH module loader
  // ---------------------------------------------------------------------------

  let resolveModule
  window.__MODULE_READY__ = new Promise((resolve) => {
    resolveModule = resolve
  })

  let loadedModule = null
  window.__ModuleLoader__ = {
    load(definition) {
      if (definition === null || typeof definition !== 'object' || typeof definition.factory !== 'function') {
        throw new Error('mini-host: __ModuleLoader__.load expects { id, factory }')
      }
      if (loadedModule !== null) throw new Error('mini-host: module already loaded')
      const require = (name) => {
        if (name === 'react') return window.MiniReact
        if (name === 'react/jsx-runtime') return window.MiniReact
        throw new Error(`mini-host: unexpected require(${JSON.stringify(name)})`)
      }
      const exportsObject = definition.factory(require)
      loadedModule = { id: definition.id, plugin: exportsObject }
      resolveModule(loadedModule)
    },
  }

  // ---------------------------------------------------------------------------
  // DSH plugin context
  // ---------------------------------------------------------------------------

  const LC = {}
  let dictionaries = {}
  function interpolate(template, values) {
    if (values === null || values === undefined) return template
    return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => {
      const value = values[key]
      return value === undefined || value === null ? match : String(value)
    })
  }

  function translate(key, values) {
    const template = dictionaries[key] !== undefined ? dictionaries[key] : key
    return interpolate(template, values)
  }

  const slots = {}
  const locals = { slots, locale: {}, effect: null }
  const effectCleanups = []
  const context = {
    effect(fn) {
      if (typeof fn !== 'function') throw new Error('mini-host: ctx.effect expects a function')
      const result = fn()
      if (typeof result === 'function') effectCleanups.push(result)
      return () => {
        const index = effectCleanups.indexOf(result)
        if (index !== -1) effectCleanups.splice(index, 1)
        if (typeof result === 'function') result()
      }
    },
    locale: {
      register(namespace, dictionariesObject) {
        LC[namespace] = dictionariesObject
        dictionaries = dictionariesObject.en || dictionariesObject[Object.keys(dictionariesObject)[0]] || {}
        return () => {
          delete LC[namespace]
        }
      },
      bind(namespace) {
        const skip = namespace !== undefined
        return (key, values) => translate(key, values)
      },
    },
    slots: {
      inject(name, factory) {
        const registered = factory()
        if (name !== undefined && registered !== undefined) slots[name] = registered
        return registered
      },
      register(meta, component) {
        const entry = { meta, component }
        if (meta !== null && typeof meta === 'object' && typeof meta.name === 'string') slots[meta.name] = entry
        return entry
      },
    },
    // Exposed for the harness boot script, not part of the plugin API.
    __harness: { slots, effectCleanups },
  }

  window.__HARNESS_CTX__ = context
  void locals
})()
