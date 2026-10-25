/**
 * dsh-moodboard — browser half.
 *
 * Registers a root global panel ("Moodboard") in the sidebar, its page in the
 * keyed `main` slot, and a compact composer control that inserts a style-guide
 * directive into the draft.
 *
 * Plain browser JavaScript loaded by the Harness module loader: the factory may
 * require only `react`; no build step, no JSX, no third-party modules.
 *
 * The Host half owns persistence and the HTTP API under `/moodboard`; this
 * module only calls it and renders the result. All state lives in one
 * module-level store shared by every mount.
 */

window.__ModuleLoader__.load({
  id: '@stijnus/dsh-moodboard',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useSyncExternalStore } = React

    // ---------------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------------

    const NS = 'moodboard'
    const API_ROOT = '/moodboard/api'
    const MAX_FILE_BYTES = 25 * 1024 * 1024
    const MAX_EDGE = 1600
    const ENCODE_QUALITY = 0.85
    const MAX_IMAGES = 200
    const MAX_TAGS = 20
    const MAX_TAG_LENGTH = 48
    const MAX_NAME_LENGTH = 200
    const MAX_NOTES_LENGTH = 4000
    const MAX_SOURCE_URL_LENGTH = 2000
    const MAX_ERROR_CHARS = 320

    // ---------------------------------------------------------------------------
    // Locale dictionaries (every visible string is addressed through these)
    // ---------------------------------------------------------------------------

    const DICTIONARIES = {
      en: {
        panel: 'Moodboard',
        reference: 'Moodboard',
        referenceEmpty: 'Add images to the moodboard first',
        referenceInsert: 'Insert the moodboard style-guide directive into the draft',
        referenceInserted: 'Moodboard directive inserted into the draft',
        insertFailed: 'Could not insert the directive into the draft.',
        agentDirective:
          'Use my Moodboard style guide ({count} pinned references). Call the moodboard tool with action="active" before designing UI, and match the pinned references\' typography, color palette, spacing, radius, iconography and component styling exactly.',

        imageCountOne: '1 image',
        imageCountMany: '{count} images',
        pinnedCountOne: '1 pinned',
        pinnedCountMany: '{count} pinned',
        addImages: 'Add images',
        copyBrief: 'Copy agent brief',
        copyingBrief: 'Copying…',
        briefCopied: 'Agent brief copied to the clipboard',
        briefEmpty: 'The board is empty — add images first.',
        copyFailed: 'Could not copy the agent brief: {message}',
        copyUnsupported: 'Clipboard access is unavailable in this browser.',

        retry: 'Retry',
        dismiss: 'Dismiss',

        dropHint: 'Drag image files anywhere on this page to add them.',
        dropZoneLabel: 'Moodboard upload area',
        dropOverlay: 'Drop images to add them',
        uploadsHeading: 'Uploads',
        clearUploads: 'Clear',
        uploadingFile: 'Adding {name}…',
        uploadDone: 'Added {name}',
        uploadFailed: '{name}: {message}',
        uploadComplete: 'Upload finished — {count} added.',
        uploadFinishedWithErrors: 'Upload finished — {count} failed.',
        boardFull: 'The moodboard already holds the maximum of 200 images.',
        fileNotImage: '{name} is not an image file.',
        fileTooLarge: '{name} is larger than 25 MB.',
        decodeFailed: 'Could not decode {name} as an image.',
        encodeFailed: 'Could not prepare {name} for upload.',

        activeGuide: 'Active style guide',
        activeGuideHint: 'The agent reads these images before designing UI.',
        activeGuideEmpty: 'Pin images to build the style guide the agent reads.',
        gallery: 'Gallery',
        filterLabel: 'Filter by tag',
        allTags: 'All',
        tagChip: '{tag} ({count})',
        noMatches: 'No images have this tag yet.',

        emptyTitle: 'Your moodboard is empty',
        emptyBody:
          'Add reference images to capture the typography, palette, spacing and components you want the agent to match.',
        loading: 'Loading moodboard…',
        loadErrorTitle: 'Could not load the moodboard',
        loadErrorBody: 'Make sure the plugin Host is running, then try again.',
        loadFailed: 'Could not load the moodboard: {message}',
        networkError: 'Network request failed.',

        details: 'Image details',
        detailsFor: 'Details for {name}',
        selectImage: 'Select {name}',
        previewAlt: 'Preview of {name}',
        openSource: 'Open source link',
        closeDetails: 'Close details',

        name: 'Name',
        namePlaceholder: 'Image name',
        notes: 'Notes',
        notesPlaceholder: 'Colors, typography, spacing, radius, components, motion…',
        sourceUrl: 'Source URL',
        sourcePlaceholder: 'https://…',
        sourceHint: 'Only http and https links are kept.',
        tags: 'Tags',
        addTag: 'Add tag',
        tagPlaceholder: 'Type a tag and press Enter',
        tagRemove: 'Remove tag {tag}',
        tagTooLong: 'Tags must be 48 characters or fewer.',
        tagLimit: 'An image can have at most 20 tags.',
        tagDuplicate: 'That tag is already on this image.',
        tagEmpty: 'Enter a tag first.',

        pin: 'Pin',
        unpin: 'Unpin',
        pinName: 'Pin {name} to the style guide',
        unpinName: 'Unpin {name} from the style guide',
        pinnedBadge: 'Pinned',
        pinnedOn: 'Pinned {name} to the style guide',
        pinnedOff: 'Unpinned {name} from the style guide',
        pinFailed: 'Could not update the pin: {message}',
        pinSwitch: 'Use as a style-guide reference',

        replace: 'Replace',
        replaceLabel: 'Replace {name}',
        replacing: 'Replacing {name}…',
        replaceBusy: 'Replacing…',
        replaceDone: 'Replaced {name}',
        replaceFailed: 'Could not replace {name}: {message}',

        remove: 'Remove',
        removeName: 'Remove {name}',
        confirm: 'Confirm',
        cancel: 'Cancel',
        confirmRemove: 'Remove “{name}” from the moodboard?',
        confirmRemoveQuestion: 'Remove this image?',
        removed: 'Removed {name}',
        removeFailed: 'Could not remove the image: {message}',
        imageGone: 'That image no longer exists; the board was refreshed.',

        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        dirty: 'Unsaved changes',
        discardTitle: 'Discard unsaved changes?',
        discard: 'Discard changes',
        keepEditing: 'Keep editing',
        saveFailed: 'Could not save the image: {message}',
      },
      zh: {
        panel: '灵感板',
        reference: '灵感板',
        referenceEmpty: '请先向灵感板添加图片',
        referenceInsert: '将灵感板风格指南指令插入草稿',
        referenceInserted: '已将灵感板指令插入草稿',
        insertFailed: '无法将指令插入草稿。',
        agentDirective:
          '请使用我的灵感板风格指南（{count} 张已钉选参考图）。在设计界面之前，调用 moodboard 工具并传入 action="active"，然后严格匹配这些参考图的字体排印、配色、间距、圆角、图标和组件样式。',

        imageCountOne: '1 张图片',
        imageCountMany: '{count} 张图片',
        pinnedCountOne: '1 张已钉选',
        pinnedCountMany: '{count} 张已钉选',
        addImages: '添加图片',
        copyBrief: '复制代理摘要',
        copyingBrief: '复制中…',
        briefCopied: '已将代理摘要复制到剪贴板',
        briefEmpty: '灵感板为空——请先添加图片。',
        copyFailed: '无法复制代理摘要：{message}',
        copyUnsupported: '当前浏览器无法访问剪贴板。',

        retry: '重试',
        dismiss: '关闭',

        dropHint: '将图片文件拖到本页任意位置即可添加。',
        dropZoneLabel: '灵感板上传区域',
        dropOverlay: '松开以添加图片',
        uploadsHeading: '上传',
        clearUploads: '清除',
        uploadingFile: '正在添加 {name}…',
        uploadDone: '已添加 {name}',
        uploadFailed: '{name}：{message}',
        uploadComplete: '上传完成，已添加 {count} 张。',
        uploadFinishedWithErrors: '上传完成，{count} 个失败。',
        boardFull: '灵感板已达到 200 张图片的上限。',
        fileNotImage: '{name} 不是图片文件。',
        fileTooLarge: '{name} 超过 25 MB。',
        decodeFailed: '无法将 {name} 解码为图片。',
        encodeFailed: '无法准备上传 {name}。',

        activeGuide: '当前风格指南',
        activeGuideHint: '代理在设计界面之前会读取这些图片。',
        activeGuideEmpty: '钉选图片以构建代理读取的风格指南。',
        gallery: '图片库',
        filterLabel: '按标签筛选',
        allTags: '全部',
        tagChip: '{tag}（{count}）',
        noMatches: '还没有图片使用这个标签。',

        emptyTitle: '灵感板还是空的',
        emptyBody: '添加参考图片，记录你希望代理匹配的字体排印、配色、间距和组件。',
        loading: '正在加载灵感板…',
        loadErrorTitle: '无法加载灵感板',
        loadErrorBody: '请确认插件 Host 正在运行，然后重试。',
        loadFailed: '无法加载灵感板：{message}',
        networkError: '网络请求失败。',

        details: '图片详情',
        detailsFor: '{name} 的详情',
        selectImage: '选择 {name}',
        previewAlt: '{name} 的预览',
        openSource: '打开来源链接',
        closeDetails: '关闭详情',

        name: '名称',
        namePlaceholder: '图片名称',
        notes: '备注',
        notesPlaceholder: '配色、字体排印、间距、圆角、组件、动效…',
        sourceUrl: '来源链接',
        sourcePlaceholder: 'https://…',
        sourceHint: '仅保留 http 和 https 链接。',
        tags: '标签',
        addTag: '添加标签',
        tagPlaceholder: '输入标签后按回车',
        tagRemove: '移除标签 {tag}',
        tagTooLong: '标签不能超过 48 个字符。',
        tagLimit: '每张图片最多 20 个标签。',
        tagDuplicate: '该标签已在这张图片上。',
        tagEmpty: '请先输入标签。',

        pin: '钉选',
        unpin: '取消钉选',
        pinName: '将 {name} 钉选到风格指南',
        unpinName: '将 {name} 从风格指南中取消钉选',
        pinnedBadge: '已钉选',
        pinnedOn: '已将 {name} 钉选到风格指南',
        pinnedOff: '已将 {name} 从风格指南中取消钉选',
        pinFailed: '无法更新钉选状态：{message}',
        pinSwitch: '用作风格指南参考',

        replace: '替换',
        replaceLabel: '替换 {name}',
        replacing: '正在替换 {name}…',
        replaceBusy: '替换中…',
        replaceDone: '已替换 {name}',
        replaceFailed: '无法替换 {name}：{message}',

        remove: '移除',
        removeName: '移除 {name}',
        confirm: '确认',
        cancel: '取消',
        confirmRemove: '从灵感板中移除“{name}”？',
        confirmRemoveQuestion: '移除这张图片？',
        removed: '已移除 {name}',
        removeFailed: '无法移除图片：{message}',
        imageGone: '该图片已不存在，灵感板已刷新。',

        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        dirty: '有未保存的更改',
        discardTitle: '放弃未保存的更改？',
        discard: '放弃更改',
        keepEditing: '继续编辑',
        saveFailed: '无法保存图片：{message}',
      },
    }

    // ---------------------------------------------------------------------------
    // Small helpers
    // ---------------------------------------------------------------------------

    /** Set once from `ctx.locale.bind(NS)` in apply(); store code translates through it. */
    let activeTranslate = (key) => key

    /** Translate a store-level string (components prefer their injected `t`). */
    function msg(key, params) {
      if (params === undefined) return activeTranslate(key)
      return activeTranslate(key, params)
    }

    function createError(message, code) {
      const error = new Error(message)
      error.code = code
      return error
    }

    function errorCode(error) {
      if (error === null || error === undefined) return ''
      return typeof error.code === 'string' ? error.code : ''
    }

    function messageOf(error) {
      if (error instanceof Error && typeof error.message === 'string' && error.message !== '') {
        return error.message.length > MAX_ERROR_CHARS ? `${error.message.slice(0, MAX_ERROR_CHARS)}…` : error.message
      }
      if (typeof error === 'string' && error !== '') return error
      return msg('networkError')
    }

    function stringOr(value, fallback) {
      return typeof value === 'string' ? value : fallback
    }

    function finiteOr(value, fallback) {
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback
    }

    function isHttpUrl(value) {
      if (typeof value !== 'string' || value === '') return false
      try {
        const parsed = new URL(value)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      } catch (error) {
        return false
      }
    }

    function imageCountText(t, count) {
      return count === 1 ? t('imageCountOne') : t('imageCountMany', { count })
    }

    function pinnedCountText(t, count) {
      return count === 1 ? t('pinnedCountOne') : t('pinnedCountMany', { count })
    }

    function getTranslator(props) {
      return typeof props.t === 'function' ? props.t : msg
    }

    // ---------------------------------------------------------------------------
    // Board normalization
    // ---------------------------------------------------------------------------

    function computeTagCounts(images) {
      const counts = {}
      for (const image of images) {
        for (const tag of image.tags) {
          counts[tag] = Number.isFinite(counts[tag]) ? counts[tag] + 1 : 1
        }
      }
      return counts
    }

    function sortImages(images) {
      return images.slice().sort((left, right) => {
        if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
        if (left.order !== right.order) return left.order - right.order
        return String(left.createdAt).localeCompare(String(right.createdAt))
      })
    }

    function normalizeImage(raw) {
      if (raw === null || typeof raw !== 'object') return null
      const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : ''
      if (id === '') return null
      const tags = []
      if (Array.isArray(raw.tags)) {
        for (const tag of raw.tags) {
          if (typeof tag !== 'string') continue
          const trimmed = tag.trim()
          if (trimmed === '' || trimmed.length > MAX_TAG_LENGTH) continue
          if (tags.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) continue
          tags.push(trimmed)
          if (tags.length >= MAX_TAGS) break
        }
      }
      let name = stringOr(raw.name, '').trim()
      if (name === '') name = 'image'
      name = name.slice(0, MAX_NAME_LENGTH)
      return {
        id,
        name,
        tags,
        notes: stringOr(raw.notes, ''),
        sourceUrl: isHttpUrl(stringOr(raw.sourceUrl, '')) ? stringOr(raw.sourceUrl, '') : '',
        pinned: raw.pinned === true,
        order: finiteOr(raw.order, 0),
        createdAt: stringOr(raw.createdAt, ''),
        updatedAt: stringOr(raw.updatedAt, ''),
        mediaType: stringOr(raw.mediaType, ''),
        bytes: finiteOr(raw.bytes, 0),
        width: finiteOr(raw.width, 0),
        height: finiteOr(raw.height, 0),
        imageUrl:
          typeof raw.imageUrl === 'string' && raw.imageUrl !== ''
            ? raw.imageUrl
            : `/moodboard/image/${encodeURIComponent(id)}`,
      }
    }

    function normalizeBoard(raw) {
      const board = raw !== null && typeof raw === 'object' ? raw : {}
      const images = []
      if (Array.isArray(board.images)) {
        for (const entry of board.images) {
          const image = normalizeImage(entry)
          if (image !== null) images.push(image)
        }
      }
      const sorted = sortImages(images)
      const pinned = []
      for (const image of sorted) {
        if (image.pinned) pinned.push(image.id)
      }
      const tagCounts = computeTagCounts(sorted)
      let allTags = []
      if (Array.isArray(board.allTags)) {
        for (const tag of board.allTags) {
          if (typeof tag === 'string' && tag !== '' && allTags.indexOf(tag) === -1) allTags.push(tag)
        }
      }
      if (allTags.length === 0) allTags = Object.keys(tagCounts)
      return {
        version: finiteOr(board.version, 1),
        updatedAt: typeof board.updatedAt === 'string' ? board.updatedAt : null,
        images: sorted,
        allTags,
        tagCounts,
        pinned,
      }
    }

    function countForTag(board, tag) {
      const value = board.tagCounts[tag]
      return Number.isFinite(value) ? value : 0
    }

    function imageKey(image) {
      return `${image.id}|${image.updatedAt}|${image.imageUrl}`
    }

    // ---------------------------------------------------------------------------
    // Image blob cache (one object URL per image revision, revoked on disposal)
    // ---------------------------------------------------------------------------

    const imageUrlCache = new Map()
    const imageUrlInflight = new Map()
    let disposed = false

    function loadImageUrl(key, url) {
      const cached = imageUrlCache.get(key)
      if (cached !== undefined) return Promise.resolve(cached)
      const pending = imageUrlInflight.get(key)
      if (pending !== undefined) return pending
      const promise = (async () => {
        try {
          const response = await fetch(url, { credentials: 'same-origin' })
          if (!response.ok) throw createError(`HTTP ${response.status}`, 'image-load')
          const blob = await response.blob()
          const objectUrl = URL.createObjectURL(blob)
          if (disposed) {
            URL.revokeObjectURL(objectUrl)
            throw createError('disposed', 'image-load')
          }
          imageUrlCache.set(key, objectUrl)
          return objectUrl
        } finally {
          imageUrlInflight.delete(key)
        }
      })()
      imageUrlInflight.set(key, promise)
      return promise
    }

    function disposeImageUrls() {
      disposed = true
      for (const objectUrl of imageUrlCache.values()) {
        try {
          URL.revokeObjectURL(objectUrl)
        } catch (error) {
          // Revoking an already-revoked URL is harmless.
        }
      }
      imageUrlCache.clear()
      imageUrlInflight.clear()
    }

    function useImageUrl(image) {
      const key = image === null || image === undefined ? '' : imageKey(image)
      const [url, setUrl] = useState(() => (key === '' ? '' : imageUrlCache.get(key) || ''))
      useEffect(() => {
        if (key === '') {
          setUrl('')
          return undefined
        }
        const cached = imageUrlCache.get(key)
        if (cached !== undefined) {
          setUrl(cached)
          return undefined
        }
        let cancelled = false
        loadImageUrl(key, image.imageUrl)
          .then((objectUrl) => {
            if (!cancelled) setUrl(objectUrl)
          })
          .catch(() => {
            if (!cancelled) setUrl('')
          })
        return () => {
          cancelled = true
        }
      }, [key])
      return url
    }

    // ---------------------------------------------------------------------------
    // HTTP helpers
    // ---------------------------------------------------------------------------

    function readErrorPayload(payload, status) {
      if (payload !== null && typeof payload === 'object') {
        const error = payload.error
        if (error !== null && typeof error === 'object' && typeof error.message === 'string' && error.message !== '') {
          return { message: error.message, code: typeof error.code === 'string' ? error.code : '' }
        }
      }
      return { message: `HTTP ${status}`, code: '' }
    }

    async function requestJson(path, options) {
      const settings = options === undefined || options === null ? {} : options
      const init = {
        method: typeof settings.method === 'string' ? settings.method : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      }
      if (settings.headers !== undefined && settings.headers !== null) {
        for (const name of Object.keys(settings.headers)) init.headers[name] = settings.headers[name]
      }
      if (settings.body !== undefined) init.body = settings.body
      let response = null
      try {
        response = await fetch(path, init)
      } catch (cause) {
        throw createError(msg('networkError'), 'network')
      }
      let payload = null
      try {
        payload = await response.json()
      } catch (cause) {
        payload = null
      }
      if (response.ok && payload !== null && payload.ok === true) return payload
      const info = readErrorPayload(payload, response.status)
      throw createError(info.message, info.code)
    }

    // ---------------------------------------------------------------------------
    // Shared store
    // ---------------------------------------------------------------------------

    function createSnapshot() {
      return {
        board: null,
        loading: false,
        uploading: false,
        mutating: false,
        error: '',
        statusText: '',
        selectedId: null,
        tagFilter: '',
        uploads: [],
        editorDirty: false,
        // `undefined` means "no pending selection"; `null` is a real target
        // (close the details panel) and is kept distinct on purpose.
        pendingSelectId: undefined,
      }
    }

    let snapshot = createSnapshot()
    const listeners = new Set()
    let refreshToken = 0
    let uploadKeySeq = 0

    function setState(patch) {
      snapshot = { ...snapshot, ...patch }
      for (const listener of Array.from(listeners)) {
        try {
          listener()
        } catch (error) {
          // A broken subscriber must not stop the others or the action.
        }
      }
    }

    function subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }

    function getSnapshot() {
      return snapshot
    }

    function clearError() {
      setState({ error: '' })
    }

    function setStatus(text) {
      setState({ statusText: typeof text === 'string' ? text : '' })
    }

    function applyBoard(rawBoard) {
      const board = normalizeBoard(rawBoard)
      const current = snapshot.selectedId
      const stillPresent = current !== null && board.images.some((image) => image.id === current)
      const filter = snapshot.tagFilter
      const filterStillPresent = filter !== '' && board.allTags.indexOf(filter) !== -1
      setState({
        board,
        loading: false,
        selectedId: stillPresent ? current : null,
        tagFilter: filterStillPresent ? filter : '',
      })
    }

    async function refresh() {
      refreshToken += 1
      const token = refreshToken
      setState({ loading: true })
      try {
        const payload = await requestJson(`${API_ROOT}/state`)
        if (token !== refreshToken) return
        applyBoard(payload.board)
      } catch (error) {
        if (token !== refreshToken) return
        setState({ loading: false, error: msg('loadFailed', { message: messageOf(error) }) })
      }
    }

    function ensureLoaded() {
      if (snapshot.board === null && !snapshot.loading) void refresh()
    }

    function selectImage(id) {
      if (snapshot.selectedId === id) return
      if (snapshot.editorDirty && snapshot.selectedId !== null) {
        setState({ pendingSelectId: id })
        return
      }
      setState({ selectedId: id })
    }

    function confirmSelect() {
      const target = snapshot.pendingSelectId
      if (target === undefined) return
      setState({ selectedId: target, pendingSelectId: undefined, editorDirty: false })
    }

    function cancelPendingSelect() {
      setState({ pendingSelectId: undefined })
    }

    function setTagFilter(tag) {
      setState({ tagFilter: typeof tag === 'string' ? tag : '' })
    }

    function setEditorDirty(dirty) {
      const next = dirty === true
      if (snapshot.editorDirty === next) return
      setState({ editorDirty: next })
    }

    // ---- uploads --------------------------------------------------------------

    function addUpload(name) {
      uploadKeySeq += 1
      const key = `mb-upload-${uploadKeySeq}`
      const entry = { key, name, state: 'working', message: msg('uploadingFile', { name }) }
      setState({ uploads: snapshot.uploads.concat([entry]) })
      return key
    }

    function updateUpload(key, patch) {
      setState({
        uploads: snapshot.uploads.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)),
      })
    }

    function failUpload(key, message) {
      updateUpload(key, { state: 'error', message })
      setStatus(message)
    }

    function clearUploads() {
      setState({ uploads: [] })
    }

    async function uploadFiles(fileList) {
      const files = []
      try {
        const length =
          fileList !== null && fileList !== undefined && typeof fileList.length === 'number' ? fileList.length : 0
        for (let index = 0; index < length; index += 1) {
          const file = fileList[index]
          if (file !== null && file !== undefined) files.push(file)
        }
      } catch (error) {
        return
      }
      if (files.length === 0) return
      setState({ uploading: true, error: '' })
      let failed = 0
      try {
        for (const file of files) {
          const ok = await uploadOne(file)
          if (!ok) failed += 1
        }
      } finally {
        setState({
          uploading: false,
          statusText:
            failed === 0
              ? msg('uploadComplete', { count: files.length })
              : msg('uploadFinishedWithErrors', { count: failed }),
        })
      }
    }

    async function uploadOne(file) {
      const name = stringOr(file.name, '') !== '' ? file.name : 'image'
      const key = addUpload(name)
      try {
        if (typeof file.type !== 'string' || file.type.indexOf('image/') !== 0) {
          failUpload(key, msg('fileNotImage', { name }))
          return false
        }
        if (typeof file.size === 'number' && file.size > MAX_FILE_BYTES) {
          failUpload(key, msg('fileTooLarge', { name }))
          return false
        }
        if (snapshot.board !== null && snapshot.board.images.length >= MAX_IMAGES) {
          failUpload(key, msg('boardFull'))
          return false
        }
        let payload = null
        try {
          payload = await prepareUploadPayload(file)
        } catch (error) {
          failUpload(key, msg(errorCode(error) === 'encode' ? 'encodeFailed' : 'decodeFailed', { name }))
          return false
        }
        await requestJson(`${API_ROOT}/images`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ data: payload.data, mediaType: payload.mediaType, name }),
        })
        updateUpload(key, { state: 'done', message: msg('uploadDone', { name }) })
        setStatus(msg('uploadDone', { name }))
        await refresh()
        return true
      } catch (error) {
        const message = msg('uploadFailed', { name, message: messageOf(error) })
        updateUpload(key, { state: 'error', message })
        setState({ error: message })
        return false
      }
    }

    async function replaceImage(image, file) {
      const name = stringOr(file.name, '') !== '' ? file.name : image.name
      const key = addUpload(name)
      updateUpload(key, { message: msg('replacing', { name }) })
      setStatus(msg('replacing', { name }))
      try {
        if (typeof file.type !== 'string' || file.type.indexOf('image/') !== 0) {
          throw createError(msg('fileNotImage', { name }), 'invalid')
        }
        if (typeof file.size === 'number' && file.size > MAX_FILE_BYTES) {
          throw createError(msg('fileTooLarge', { name }), 'invalid')
        }
        let payload = null
        try {
          payload = await prepareUploadPayload(file)
        } catch (error) {
          throw createError(msg(errorCode(error) === 'encode' ? 'encodeFailed' : 'decodeFailed', { name }), 'invalid')
        }
        await requestJson(`${API_ROOT}/images/${encodeURIComponent(image.id)}/replace`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ data: payload.data, mediaType: payload.mediaType, name }),
        })
        updateUpload(key, { state: 'done', message: msg('replaceDone', { name }) })
        setStatus(msg('replaceDone', { name }))
        await refresh()
        return true
      } catch (error) {
        const message = msg('replaceFailed', { name, message: messageOf(error) })
        updateUpload(key, { state: 'error', message })
        setState({ error: message })
        return false
      }
    }

    // ---- mutations ------------------------------------------------------------

    async function setPinned(image, pinned) {
      setState({ mutating: true, error: '' })
      try {
        await requestJson(`${API_ROOT}/images/${encodeURIComponent(image.id)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pinned: pinned === true }),
        })
        setStatus(msg(pinned === true ? 'pinnedOn' : 'pinnedOff', { name: image.name }))
        await refresh()
        return true
      } catch (error) {
        setState({ error: msg('pinFailed', { message: messageOf(error) }) })
        return false
      } finally {
        setState({ mutating: false })
      }
    }

    async function patchImage(id, fields) {
      setState({ mutating: true, error: '' })
      try {
        const payload = await requestJson(`${API_ROOT}/images/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(fields),
        })
        setStatus(msg('saved'))
        await refresh()
        const saved = payload.image === null || payload.image === undefined ? null : normalizeImage(payload.image)
        return saved
      } catch (error) {
        if (errorCode(error) === 'not-found') await refresh()
        setState({ error: msg('saveFailed', { message: messageOf(error) }) })
        return null
      } finally {
        setState({ mutating: false })
      }
    }

    async function removeImage(image) {
      setState({ mutating: true, error: '' })
      try {
        await requestJson(`${API_ROOT}/images/${encodeURIComponent(image.id)}`, { method: 'DELETE' })
        setState({
          selectedId: snapshot.selectedId === image.id ? null : snapshot.selectedId,
          statusText: msg('removed', { name: image.name }),
        })
        await refresh()
        return true
      } catch (error) {
        if (errorCode(error) === 'not-found') {
          await refresh()
          setState({ error: msg('imageGone') })
        } else {
          setState({ error: msg('removeFailed', { message: messageOf(error) }) })
        }
        return false
      } finally {
        setState({ mutating: false })
      }
    }

    // ---- clipboard ------------------------------------------------------------

    async function copyText(text) {
      if (
        navigator.clipboard !== undefined &&
        navigator.clipboard !== null &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(text)
        return
      }
      throw createError(msg('copyUnsupported'), 'copy')
    }

    async function copyBrief() {
      setState({ error: '' })
      try {
        const payload = await requestJson(`${API_ROOT}/active`)
        const brief = typeof payload.brief === 'string' ? payload.brief.trim() : ''
        if (brief === '') {
          setState({ error: msg('briefEmpty') })
          return false
        }
        await copyText(brief)
        setStatus(msg('briefCopied'))
        return true
      } catch (error) {
        setState({ error: msg('copyFailed', { message: messageOf(error) }) })
        return false
      }
    }

    // ---------------------------------------------------------------------------
    // Client-side downscale + encode pipeline
    // ---------------------------------------------------------------------------

    function loadImageElement(objectUrl) {
      return new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(createError('decode-failed', 'decode'))
        image.src = objectUrl
      })
    }

    async function decodeImageFile(file) {
      if (typeof createImageBitmap === 'function') {
        try {
          const bitmap = await createImageBitmap(file)
          return {
            drawable: bitmap,
            width: bitmap.width,
            height: bitmap.height,
            release: () => {
              if (typeof bitmap.close === 'function') bitmap.close()
            },
          }
        } catch (error) {
          // Some formats are not decodable through createImageBitmap; fall back.
        }
      }
      const objectUrl = URL.createObjectURL(file)
      try {
        const image = await loadImageElement(objectUrl)
        return {
          drawable: image,
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height,
          release: () => URL.revokeObjectURL(objectUrl),
        }
      } catch (error) {
        URL.revokeObjectURL(objectUrl)
        throw createError('decode-failed', 'decode')
      }
    }

    async function prepareUploadPayload(file) {
      const source = await decodeImageFile(file)
      try {
        const longest = Math.max(source.width, source.height)
        if (!(longest > 0)) throw createError('empty-image', 'decode')
        const scale = Math.min(1, MAX_EDGE / longest)
        const width = Math.max(1, Math.round(source.width * scale))
        const height = Math.max(1, Math.round(source.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (context === null) throw createError('no-canvas', 'encode')
        context.drawImage(source.drawable, 0, 0, width, height)
        let dataUrl = ''
        let mediaType = 'image/webp'
        try {
          dataUrl = canvas.toDataURL('image/webp', ENCODE_QUALITY)
        } catch (error) {
          dataUrl = ''
        }
        if (dataUrl.indexOf('data:image/webp') !== 0) {
          mediaType = 'image/jpeg'
          try {
            dataUrl = canvas.toDataURL('image/jpeg', ENCODE_QUALITY)
          } catch (error) {
            throw createError('encode-failed', 'encode')
          }
        }
        const expectedPrefix = mediaType === 'image/webp' ? 'data:image/webp' : 'data:image/jpeg'
        if (dataUrl.indexOf(expectedPrefix) !== 0) throw createError('encode-failed', 'encode')
        const comma = dataUrl.indexOf(',')
        if (comma === -1) throw createError('encode-failed', 'encode')
        return { data: dataUrl.slice(comma + 1), mediaType }
      } finally {
        try {
          source.release()
        } catch (error) {
          // Releasing a bitmap twice is harmless.
        }
      }
    }

    // ---------------------------------------------------------------------------
    // Composer directive insertion
    // ---------------------------------------------------------------------------

    /**
     * Insert the style-guide directive into the draft.
     *
     * Idempotent on purpose: the composer trigger keeps DOM focus after a click,
     * so a following Enter re-activates it. When the draft already contains the
     * exact directive for this pinned count nothing is inserted and only the
     * existing confirmation status is raised.
     *
     * @returns {boolean} whether the click was handled (inserted or already present).
     */
    function insertReferenceDirective(actions, draft, pinnedCount, t) {
      const text = t('agentDirective', { count: pinnedCount })
      const existing = typeof draft === 'string' ? draft : ''
      if (existing.indexOf(text) !== -1) {
        setStatus(t('referenceInserted'))
        return true
      }
      try {
        if (actions !== null && actions !== undefined && typeof actions.insertText === 'function') {
          let span
          if (typeof actions.captureInsertion === 'function') span = actions.captureInsertion()
          const inserted = actions.insertText(text, span)
          if (inserted !== false) {
            setStatus(t('referenceInserted'))
            return true
          }
        }
        if (actions !== null && actions !== undefined && typeof actions.setDraft === 'function') {
          const separator = existing.trim() === '' || /\s$/.test(existing) ? '' : ' '
          actions.setDraft(existing + separator + text)
          setStatus(t('referenceInserted'))
          return true
        }
        setState({ error: t('insertFailed') })
        return false
      } catch (error) {
        setState({ error: t('insertFailed') })
        return false
      }
    }

    /**
     * Move focus out of the composer trigger and into the draft editor after the
     * directive is handled, so the next Enter sends instead of re-activating the
     * button. The editor query is read-only; caret placement is best effort. If
     * no editor exists, blurring the button still removes the re-trigger path.
     */
    function focusComposerEditor(button) {
      let editor = null
      try {
        editor = document.querySelector('[contenteditable="true"]')
      } catch (error) {
        editor = null
      }
      if (editor === null || editor === undefined) {
        if (button !== null && button !== undefined && typeof button.blur === 'function') button.blur()
        return
      }
      try {
        editor.focus()
      } catch (error) {
        // A hidden or detached editor cannot take focus; insertion already happened.
      }
      try {
        const selection = window.getSelection()
        if (selection === null || selection === undefined || typeof document.createRange !== 'function') return
        const range = document.createRange()
        range.selectNodeContents(editor)
        range.collapse(false)
        selection.removeAllRanges()
        selection.addRange(range)
      } catch (error) {
        // Caret placement is best effort; focus alone already prevents re-triggering.
      }
    }

    // ---------------------------------------------------------------------------
    // Styles (component-local; `dsh-mb-` prefix; theme tokens only)
    // ---------------------------------------------------------------------------

    const PAGE_CSS = `
.dsh-mb-page { position: relative; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0; padding: 0 clamp(16px, 3vw, 32px) 20px; overflow: hidden; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5; }
.dsh-mb-header { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding-top: calc(20px + var(--dsh-frame-top-clearance, 0px)); }
.dsh-mb-title { margin: 0; font-size: 20px; font-weight: 500; line-height: 28px; }
.dsh-mb-sub { color: var(--dsw-alias-label-secondary); font-size: 13px; }
.dsh-mb-header-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-left: auto; }
.dsh-mb-banner { display: flex; align-items: flex-start; gap: 8px; flex: none; padding: 8px 10px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.dsh-mb-banner-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.dsh-mb-drop { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; flex: none; padding: 10px 14px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); }
.dsh-mb-page[data-drag='true'] .dsh-mb-drop { border-color: var(--dsw-alias-brand-primary); }
.dsh-mb-drop-overlay { position: absolute; inset: 12px; z-index: 10; display: flex; align-items: center; justify-content: center; border: 2px dashed var(--dsw-alias-brand-primary); border-radius: 16px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); font-size: 15px; pointer-events: none; }
.dsh-mb-body { display: flex; flex: 1; gap: 16px; min-height: 0; }
.dsh-mb-main { display: flex; flex-direction: column; gap: 16px; flex: 1; min-width: 0; min-height: 0; overflow-y: auto; padding-bottom: 8px; }
.dsh-mb-side { flex: 0 0 340px; min-width: 0; overflow-y: auto; padding-left: 16px; border-left: 1px solid var(--dsw-alias-border-l1); }
@media (max-width: 900px) {
  .dsh-mb-body { flex-direction: column; overflow-y: auto; }
  .dsh-mb-main { overflow: visible; }
  .dsh-mb-side { flex: none; overflow: visible; border-left: none; border-top: 1px solid var(--dsw-alias-border-l1); padding: 12px 0 0; }
}
.dsh-mb-btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 1; cursor: pointer; white-space: nowrap; }
.dsh-mb-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.dsh-mb-btn:disabled { opacity: 0.5; cursor: default; }
.dsh-mb-btn--primary { border-color: transparent; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.dsh-mb-btn--primary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); opacity: 0.9; }
.dsh-mb-btn--danger { color: var(--dsw-alias-state-error-primary); }
.dsh-mb-btn--icon { width: 28px; padding: 0; justify-content: center; }
.dsh-mb-section { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dsh-mb-section-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.dsh-mb-section-title { margin: 0; font-size: 14px; font-weight: 500; line-height: 22px; }
.dsh-mb-hint { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; overflow-wrap: anywhere; }
.dsh-mb-uploads { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; font-size: 12px; }
.dsh-mb-upload-row { display: flex; align-items: baseline; gap: 6px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dsh-mb-upload-row[data-state='done'] { color: var(--dsw-alias-state-success-primary); }
.dsh-mb-upload-row[data-state='error'] { color: var(--dsw-alias-state-error-primary); }
.dsh-mb-active { display: flex; gap: 8px; padding: 2px 0 6px; overflow-x: auto; }
.dsh-mb-active-item { display: flex; flex-direction: column; gap: 4px; flex: 0 0 132px; min-width: 0; }
.dsh-mb-active-thumb { position: relative; width: 132px; height: 88px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
.dsh-mb-active-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
.dsh-mb-active-meta { display: flex; align-items: center; gap: 4px; min-width: 0; }
.dsh-mb-active-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.dsh-mb-filters { display: flex; flex-wrap: wrap; gap: 6px; }
.dsh-mb-chip { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 1; cursor: pointer; white-space: nowrap; }
.dsh-mb-chip:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-mb-chip[aria-pressed='true'] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-mb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin: 0; padding: 0; list-style: none; }
.dsh-mb-card { position: relative; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); min-width: 0; }
.dsh-mb-card:hover { border-color: var(--dsw-alias-border-l2); }
.dsh-mb-card[data-selected='true'] { border-color: var(--dsw-alias-brand-primary); }
.dsh-mb-thumb-btn { display: block; width: 100%; padding: 0; border: 0; background: transparent; aspect-ratio: 4 / 3; overflow: hidden; cursor: pointer; }
.dsh-mb-thumb-btn img { display: block; width: 100%; height: 100%; object-fit: cover; }
.dsh-mb-thumb-placeholder { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.dsh-mb-pin-badge { position: absolute; top: 6px; left: 6px; display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); font-size: 11px; line-height: 1.4; }
.dsh-mb-card-meta { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 6px 8px 8px; }
.dsh-mb-card-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.dsh-mb-tags { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.dsh-mb-tag { padding: 3px 6px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1; white-space: nowrap; }
.dsh-mb-card-actions { position: absolute; top: 6px; right: 6px; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; opacity: 0; transition: opacity 0.12s ease-out; }
.dsh-mb-card:hover .dsh-mb-card-actions, .dsh-mb-card:focus-within .dsh-mb-card-actions { opacity: 1; }
.dsh-mb-card-actions .dsh-mb-btn { height: 24px; padding: 0 8px; background: var(--dsw-alias-bg-overlay); font-size: 11px; }
.dsh-mb-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 6px 8px; border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); }
.dsh-mb-confirm .dsh-mb-hint { flex: 1 1 100%; }
.dsh-mb-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 44px 16px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); text-align: center; }
.dsh-mb-empty-title { margin: 0; color: var(--dsw-alias-label-primary); font-size: 15px; font-weight: 500; }
.dsh-mb-empty-body { margin: 0; max-width: 460px; overflow-wrap: anywhere; }
.dsh-mb-details { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.dsh-mb-details-head { display: flex; align-items: center; gap: 8px; }
.dsh-mb-details-title { flex: 1; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; line-height: 22px; }
.dsh-mb-preview { overflow: hidden; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); }
.dsh-mb-preview img { display: block; width: 100%; max-height: 240px; object-fit: contain; }
.dsh-mb-preview .dsh-mb-thumb-placeholder { height: 140px; }
.dsh-mb-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dsh-mb-label { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-mb-input, .dsh-mb-textarea { box-sizing: border-box; width: 100%; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }
.dsh-mb-textarea { min-height: 88px; resize: vertical; }
.dsh-mb-input::placeholder, .dsh-mb-textarea::placeholder { color: var(--dsw-alias-label-secondary); opacity: 0.8; }
.dsh-mb-tag-editor { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.dsh-mb-tag-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 4px 3px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsh-mb-tag-remove { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; }
.dsh-mb-tag-remove:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-mb-tag-add { display: flex; gap: 4px; align-items: center; margin-top: 4px; }
.dsh-mb-tag-add .dsh-mb-input { flex: 1; }
.dsh-mb-switch { display: inline-flex; align-items: center; gap: 8px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.dsh-mb-switch-track { position: relative; flex: none; width: 34px; height: 20px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-layer-2); transition: background 0.12s ease-out; }
.dsh-mb-switch-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--dsw-alias-label-secondary); transition: transform 0.12s ease-out; }
.dsh-mb-switch[aria-checked='true'] .dsh-mb-switch-track { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); }
.dsh-mb-switch[aria-checked='true'] .dsh-mb-switch-knob { transform: translateX(14px); background: var(--dsw-alias-bg-base); }
.dsh-mb-details-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dsh-mb-details-actions .dsh-mb-btn { height: 30px; }
.dsh-mb-dirty { color: var(--dsw-alias-state-warn-primary); font-size: 12px; }
.dsh-mb-saved { color: var(--dsw-alias-state-success-primary); font-size: 12px; }
.dsh-mb-pending { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font-size: 12px; }
.dsh-mb-pending-actions { display: flex; justify-content: flex-end; gap: 6px; }
.dsh-mb-link { color: var(--dsw-alias-brand-primary); overflow-wrap: anywhere; }
.dsh-mb-visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.dsh-mb-page :focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dsh-mb-page .dsh-mb-thumb-btn:focus-visible { outline-offset: -2px; }
@media (hover: none) { .dsh-mb-card-actions { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .dsh-mb-card-actions, .dsh-mb-switch-track, .dsh-mb-switch-knob { transition: none; } }
`

    const REFERENCE_CSS = `
.dsh-mb-ref-btn { transition: background 0.12s ease-out, color 0.12s ease-out; }
.dsh-mb-ref-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-mb-ref-btn:disabled { opacity: 0.5; cursor: default; }
.dsh-mb-ref-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
`

    // ---------------------------------------------------------------------------
    // Icons (decorative inline SVG)
    // ---------------------------------------------------------------------------

    function MoodboardIcon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 18
      const strokeWidth = props.active === true ? 2 : 1.5
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 20 20',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth,
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('rect', { x: 2.5, y: 2.5, width: 6, height: 6, rx: 1.4 }),
        h('rect', { x: 11.5, y: 2.5, width: 6, height: 6, rx: 1.4 }),
        h('rect', { x: 2.5, y: 11.5, width: 6, height: 6, rx: 1.4 }),
        h('rect', { x: 11.5, y: 11.5, width: 6, height: 6, rx: 1.4 }),
      )
    }

    function IconPlus(props) {
      const size = typeof props.size === 'number' ? props.size : 12
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': 'true', focusable: 'false' },
        h('path', {
          d: 'M6 1.5v9M1.5 6h9',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          fill: 'none',
        }),
      )
    }

    function IconClose(props) {
      const size = typeof props.size === 'number' ? props.size : 12
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': 'true', focusable: 'false' },
        h('path', {
          d: 'M2.5 2.5l7 7M9.5 2.5l-7 7',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          fill: 'none',
        }),
      )
    }

    function IconPin(props) {
      const size = typeof props.size === 'number' ? props.size : 12
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': 'true', focusable: 'false' },
        h('path', {
          d: 'M7.2 1.2l3.6 3.6-1.3.5-.9 2.6-1.4 1.4-1.2-1.2-3.5 3.5-.4-.4 3.5-3.5-1.2-1.2 1.4-1.4 2.6-.9.8-1.5z',
          fill: 'currentColor',
        }),
      )
    }

    function IconPinOff(props) {
      const size = typeof props.size === 'number' ? props.size : 12
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': 'true', focusable: 'false' },
        h('path', {
          d: 'M7.2 1.2l3.6 3.6-1.3.5-.9 2.6-1.4 1.4-1.2-1.2-3.5 3.5-.4-.4 3.5-3.5-1.2-1.2 1.4-1.4 2.6-.9.8-1.5z',
          fill: 'currentColor',
          opacity: 0.55,
        }),
        h('path', { d: 'M1.5 10.5l9-9', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
      )
    }

    function IconImage(props) {
      const size = typeof props.size === 'number' ? props.size : 18
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, 'aria-hidden': 'true', focusable: 'false' },
        h('rect', { x: 2.5, y: 3.5, width: 15, height: 13, rx: 2 }),
        h('circle', { cx: 7, cy: 8, r: 1.3 }),
        h('path', { d: 'M3.5 14l4.2-4 3 2.8 2.6-2.4 3.2 3.6' }),
      )
    }

    // ---------------------------------------------------------------------------
    // Image thumbnail with cached blob URL
    // ---------------------------------------------------------------------------

    function Thumb(props) {
      const url = useImageUrl(props.image)
      if (url === '') {
        return h('span', { className: 'dsh-mb-thumb-placeholder', 'aria-hidden': 'true' }, h(IconImage, { size: 18 }))
      }
      return h('img', { src: url, alt: props.alt, loading: 'lazy', draggable: 'false' })
    }

    // ---------------------------------------------------------------------------
    // Metadata panel for the selected image
    // ---------------------------------------------------------------------------

    function MetadataPanel(props) {
      const t = getTranslator(props)
      const image = props.image
      const idBase = `dsh-mb-${image.id}`
      const [name, setName] = useState(image.name)
      const [tags, setTags] = useState(image.tags)
      const [tagInput, setTagInput] = useState('')
      const [tagError, setTagError] = useState('')
      const [notes, setNotes] = useState(image.notes)
      const [sourceUrl, setSourceUrl] = useState(image.sourceUrl)
      const [pinned, setPinned] = useState(image.pinned)
      const [saving, setSaving] = useState(false)
      const [saved, setSaved] = useState(false)
      const [confirmRemove, setConfirmRemove] = useState(false)
      const [removing, setRemoving] = useState(false)
      const [replaceBusy, setReplaceBusy] = useState(false)
      const replaceInputRef = useRef(null)
      const dirtyRef = useRef(false)
      const savingRef = useRef(false)
      const savedTimer = useRef(null)

      const dirty =
        name !== image.name ||
        notes !== image.notes ||
        sourceUrl !== image.sourceUrl ||
        pinned !== image.pinned ||
        tags.length !== image.tags.length ||
        tags.some((tag, index) => tag !== image.tags[index])

      dirtyRef.current = dirty
      savingRef.current = saving

      function loadFromImage(next) {
        setName(next.name)
        setTags(next.tags)
        setNotes(next.notes)
        setSourceUrl(next.sourceUrl)
        setPinned(next.pinned)
        setTagInput('')
        setTagError('')
      }

      useEffect(() => {
        setEditorDirty(dirty)
      }, [dirty])

      useEffect(() => {
        return () => {
          setEditorDirty(false)
        }
      }, [])

      useEffect(() => {
        if (dirtyRef.current || savingRef.current) return
        loadFromImage(image)
      }, [image.id, image.updatedAt])

      useEffect(() => {
        if (!saved) return undefined
        savedTimer.current = setTimeout(() => setSaved(false), 2000)
        return () => {
          if (savedTimer.current !== null) clearTimeout(savedTimer.current)
          savedTimer.current = null
        }
      }, [saved])

      const addTag = () => {
        const raw = tagInput.trim()
        if (raw === '') {
          setTagError(t('tagEmpty'))
          return
        }
        if (raw.length > MAX_TAG_LENGTH) {
          setTagError(t('tagTooLong'))
          return
        }
        if (tags.length >= MAX_TAGS) {
          setTagError(t('tagLimit'))
          return
        }
        if (tags.some((tag) => tag.toLowerCase() === raw.toLowerCase())) {
          setTagError(t('tagDuplicate'))
          return
        }
        setTags(tags.concat([raw]))
        setTagInput('')
        setTagError('')
      }

      const removeTag = (tag) => {
        setTags(tags.filter((entry) => entry !== tag))
      }

      const onSave = async () => {
        if (saving) return
        setSaving(true)
        setSaved(false)
        try {
          const trimmedName = name.trim()
          const savedImage = await patchImage(image.id, {
            name: trimmedName === '' ? 'image' : trimmedName.slice(0, MAX_NAME_LENGTH),
            tags,
            notes,
            sourceUrl: sourceUrl.trim(),
            pinned,
          })
          if (savedImage !== null) {
            loadFromImage(savedImage)
            setSaved(true)
          }
        } finally {
          setSaving(false)
        }
      }

      const onCancel = () => {
        loadFromImage(image)
        setSaved(false)
      }

      const requestReplace = () => {
        const input = replaceInputRef.current
        if (input !== null) input.click()
      }

      const onReplaceFile = async (event) => {
        const input = event.currentTarget
        const files = input.files
        const file = files !== null && files !== undefined && files.length > 0 ? files[0] : null
        input.value = ''
        if (file === null) return
        setReplaceBusy(true)
        try {
          await replaceImage(image, file)
        } finally {
          setReplaceBusy(false)
        }
      }

      const onConfirmRemove = async () => {
        setRemoving(true)
        try {
          await removeImage(image)
        } finally {
          setRemoving(false)
          setConfirmRemove(false)
        }
      }

      const nameId = `${idBase}-name`
      const notesId = `${idBase}-notes`
      const sourceId = `${idBase}-source`
      const tagsId = `${idBase}-tags`
      const tagErrorId = `${idBase}-tag-error`

      return h(
        'div',
        { className: 'dsh-mb-details', role: 'region', 'aria-label': t('detailsFor', { name: image.name }) },
        h(
          'div',
          { className: 'dsh-mb-details-head' },
          h('h2', { className: 'dsh-mb-details-title', title: image.name }, image.name),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mb-btn dsh-mb-btn--icon',
              'aria-label': t('closeDetails'),
              title: t('closeDetails'),
              onClick: props.onClose,
            },
            h(IconClose, { size: 12 }),
          ),
        ),
        h('div', { className: 'dsh-mb-preview' }, h(Thumb, { image, alt: t('previewAlt', { name: image.name }) })),
        h(
          'div',
          { className: 'dsh-mb-field' },
          h('label', { className: 'dsh-mb-label', htmlFor: nameId }, t('name')),
          h('input', {
            id: nameId,
            className: 'dsh-mb-input',
            type: 'text',
            value: name,
            maxLength: MAX_NAME_LENGTH,
            placeholder: t('namePlaceholder'),
            onChange: (event) => setName(event.currentTarget.value.slice(0, MAX_NAME_LENGTH)),
          }),
        ),
        h(
          'div',
          { className: 'dsh-mb-field' },
          h('span', { className: 'dsh-mb-label', id: tagsId }, t('tags')),
          h(
            'div',
            { className: 'dsh-mb-tag-editor' },
            tags.map((tag) =>
              h(
                'span',
                { key: tag, className: 'dsh-mb-tag-chip' },
                h('span', null, tag),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-mb-tag-remove',
                    'aria-label': t('tagRemove', { tag }),
                    title: t('tagRemove', { tag }),
                    onClick: () => removeTag(tag),
                  },
                  h(IconClose, { size: 9 }),
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'dsh-mb-tag-add' },
            h('input', {
              className: 'dsh-mb-input',
              type: 'text',
              value: tagInput,
              maxLength: MAX_TAG_LENGTH,
              placeholder: t('tagPlaceholder'),
              'aria-labelledby': tagsId,
              'aria-describedby': tagError === '' ? undefined : tagErrorId,
              'aria-invalid': tagError === '' ? undefined : 'true',
              onChange: (event) => {
                setTagInput(event.currentTarget.value)
                setTagError('')
              },
              onKeyDown: (event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                addTag()
              },
            }),
            h('button', { type: 'button', className: 'dsh-mb-btn', onClick: addTag }, t('addTag')),
          ),
          tagError !== '' ? h('span', { className: 'dsh-mb-dirty', id: tagErrorId, role: 'alert' }, tagError) : null,
        ),
        h(
          'div',
          { className: 'dsh-mb-field' },
          h('label', { className: 'dsh-mb-label', htmlFor: notesId }, t('notes')),
          h('textarea', {
            id: notesId,
            className: 'dsh-mb-textarea',
            value: notes,
            maxLength: MAX_NOTES_LENGTH,
            placeholder: t('notesPlaceholder'),
            onChange: (event) => setNotes(event.currentTarget.value),
          }),
        ),
        h(
          'div',
          { className: 'dsh-mb-field' },
          h('label', { className: 'dsh-mb-label', htmlFor: sourceId }, t('sourceUrl')),
          h('input', {
            id: sourceId,
            className: 'dsh-mb-input',
            type: 'url',
            inputMode: 'url',
            value: sourceUrl,
            maxLength: MAX_SOURCE_URL_LENGTH,
            placeholder: t('sourcePlaceholder'),
            onChange: (event) => setSourceUrl(event.currentTarget.value),
          }),
          h('span', { className: 'dsh-mb-hint' }, t('sourceHint')),
          isHttpUrl(image.sourceUrl)
            ? h(
                'a',
                { className: 'dsh-mb-link', href: image.sourceUrl, target: '_blank', rel: 'noopener noreferrer' },
                t('openSource'),
              )
            : null,
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-mb-switch',
            role: 'switch',
            'aria-checked': pinned ? 'true' : 'false',
            onClick: () => setPinned(!pinned),
          },
          h(
            'span',
            { className: 'dsh-mb-switch-track', 'aria-hidden': 'true' },
            h('span', { className: 'dsh-mb-switch-knob' }),
          ),
          h('span', null, t('pinSwitch')),
        ),
        h(
          'div',
          { className: 'dsh-mb-details-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mb-btn dsh-mb-btn--primary',
              disabled: saving || !dirty || props.mutating,
              'aria-busy': saving ? 'true' : undefined,
              onClick: onSave,
            },
            saving ? t('saving') : t('save'),
          ),
          h(
            'button',
            { type: 'button', className: 'dsh-mb-btn', disabled: saving || !dirty, onClick: onCancel },
            t('cancel'),
          ),
          dirty ? h('span', { className: 'dsh-mb-dirty' }, t('dirty')) : null,
          saved ? h('span', { className: 'dsh-mb-saved', role: 'status' }, t('saved')) : null,
        ),
        h(
          'div',
          { className: 'dsh-mb-details-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mb-btn',
              disabled: saving || replaceBusy || removing,
              onClick: requestReplace,
            },
            replaceBusy ? t('replaceBusy') : t('replace'),
          ),
          confirmRemove
            ? h(
                React.Fragment,
                null,
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-mb-btn dsh-mb-btn--danger',
                    autoFocus: true,
                    disabled: removing,
                    onClick: onConfirmRemove,
                  },
                  removing ? t('remove') : t('confirm'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'dsh-mb-btn', onClick: () => setConfirmRemove(false) },
                  t('cancel'),
                ),
              )
            : h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-mb-btn dsh-mb-btn--danger',
                  disabled: saving,
                  onClick: () => setConfirmRemove(true),
                },
                t('remove'),
              ),
        ),
        confirmRemove
          ? h('p', { className: 'dsh-mb-hint', role: 'alert' }, t('confirmRemove', { name: image.name }))
          : null,
        h('input', {
          ref: replaceInputRef,
          type: 'file',
          accept: 'image/*',
          className: 'dsh-mb-visually-hidden',
          tabIndex: -1,
          'aria-hidden': 'true',
          onChange: onReplaceFile,
        }),
      )
    }

    // ---------------------------------------------------------------------------
    // Panel page
    // ---------------------------------------------------------------------------

    function MoodboardPage(props) {
      const t = getTranslator(props)
      const state = useSyncExternalStore(subscribe, getSnapshot)
      const [dragActive, setDragActive] = useState(false)
      const [copying, setCopying] = useState(false)
      const [confirmRemoveId, setConfirmRemoveId] = useState(null)
      const dragDepth = useRef(0)
      const fileInputRef = useRef(null)
      const replaceInputRef = useRef(null)
      const replaceTargetRef = useRef(null)
      const discardRef = useRef(null)

      useEffect(() => {
        ensureLoaded()
      }, [])

      useEffect(() => {
        if (state.pendingSelectId !== undefined && discardRef.current !== null) discardRef.current.focus()
      }, [state.pendingSelectId])

      useEffect(() => {
        if (confirmRemoveId === null) return
        const board = state.board
        if (board === null || !board.images.some((image) => image.id === confirmRemoveId)) setConfirmRemoveId(null)
      }, [state.board, confirmRemoveId])

      const board = state.board
      const images = board === null ? [] : board.images
      const pinnedImages = images.filter((image) => image.pinned)
      const selectedImage =
        state.selectedId === null ? null : images.find((image) => image.id === state.selectedId) || null
      const filtered =
        state.tagFilter === ''
          ? images
          : images.filter((image) =>
              image.tags.some((tag) => tag.toLowerCase() === state.tagFilter.toLowerCase()),
            )

      function hasFileDrag(event) {
        const transfer = event.dataTransfer
        if (transfer === null || transfer === undefined) return false
        const types = transfer.types
        if (types === null || types === undefined) return false
        try {
          for (let index = 0; index < types.length; index += 1) {
            if (types[index] === 'Files') return true
          }
        } catch (error) {
          return false
        }
        return false
      }

      const onDragEnter = (event) => {
        if (!hasFileDrag(event)) return
        event.preventDefault()
        dragDepth.current += 1
        setDragActive(true)
      }

      const onDragOver = (event) => {
        if (!hasFileDrag(event)) return
        event.preventDefault()
        if (event.dataTransfer !== null && event.dataTransfer !== undefined) event.dataTransfer.dropEffect = 'copy'
      }

      const onDragLeave = (event) => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0 || event.relatedTarget === null) {
          dragDepth.current = 0
          setDragActive(false)
        }
      }

      const onDrop = (event) => {
        // Prevent the browser from navigating to a dropped file even when the
        // transfer does not advertise the `Files` type.
        event.preventDefault()
        dragDepth.current = 0
        setDragActive(false)
        const transfer = event.dataTransfer
        if (transfer === null || transfer === undefined) return
        const files = transfer.files
        if (files !== null && files !== undefined && files.length > 0) void uploadFiles(files)
      }

      const openFilePicker = () => {
        const input = fileInputRef.current
        if (input !== null) input.click()
      }

      const onFileInputChange = (event) => {
        const input = event.currentTarget
        const selected = []
        try {
          if (input.files !== null && input.files !== undefined) {
            for (let index = 0; index < input.files.length; index += 1) selected.push(input.files[index])
          }
        } catch (error) {
          selected.length = 0
        }
        input.value = ''
        if (selected.length > 0) void uploadFiles(selected)
      }

      const onCopyBrief = async () => {
        if (copying) return
        setCopying(true)
        try {
          await copyBrief()
        } finally {
          setCopying(false)
        }
      }

      const requestReplace = (image) => {
        replaceTargetRef.current = image
        const input = replaceInputRef.current
        if (input !== null) input.click()
      }

      const onReplaceInputChange = (event) => {
        const input = event.currentTarget
        const files = input.files
        const file = files !== null && files !== undefined && files.length > 0 ? files[0] : null
        input.value = ''
        const target = replaceTargetRef.current
        replaceTargetRef.current = null
        if (file !== null && target !== null) void replaceImage(target, file)
      }

      const onRemove = async (image) => {
        setConfirmRemoveId(null)
        await removeImage(image)
      }

      const renderCard = (image) => {
        const selected = image.id === state.selectedId
        const confirming = confirmRemoveId === image.id
        return h(
          'li',
          { key: image.id, className: 'dsh-mb-card', 'data-selected': selected ? 'true' : 'false' },
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mb-thumb-btn',
              'aria-pressed': selected ? 'true' : 'false',
              'aria-label': t('selectImage', { name: image.name }),
              onClick: () => selectImage(image.id),
            },
            h(Thumb, { image, alt: image.name }),
          ),
          image.pinned
            ? h('span', { className: 'dsh-mb-pin-badge' }, h(IconPin, { size: 10 }), t('pinnedBadge'))
            : null,
          h(
            'div',
            { className: 'dsh-mb-card-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-mb-btn',
                title: t(image.pinned ? 'unpinName' : 'pinName', { name: image.name }),
                'aria-label': t(image.pinned ? 'unpinName' : 'pinName', { name: image.name }),
                disabled: state.mutating,
                onClick: () => {
                  void setPinned(image, !image.pinned)
                },
              },
              image.pinned ? t('unpin') : t('pin'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-mb-btn',
                title: t('replaceLabel', { name: image.name }),
                'aria-label': t('replaceLabel', { name: image.name }),
                disabled: state.mutating,
                onClick: () => requestReplace(image),
              },
              t('replace'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-mb-btn dsh-mb-btn--danger',
                title: t('removeName', { name: image.name }),
                'aria-label': t('removeName', { name: image.name }),
                disabled: state.mutating,
                onClick: () => setConfirmRemoveId(image.id),
              },
              t('remove'),
            ),
          ),
          h(
            'div',
            { className: 'dsh-mb-card-meta' },
            h('span', { className: 'dsh-mb-card-name', title: image.name }, image.name),
            image.tags.length > 0
              ? h(
                  'div',
                  { className: 'dsh-mb-tags' },
                  image.tags.slice(0, 3).map((tag) => h('span', { key: tag, className: 'dsh-mb-tag' }, tag)),
                  image.tags.length > 3
                    ? h('span', { className: 'dsh-mb-tag' }, `+${image.tags.length - 3}`)
                    : null,
                )
              : null,
          ),
          confirming
            ? h(
                'div',
                { className: 'dsh-mb-confirm', role: 'group', 'aria-label': t('confirmRemoveQuestion') },
                h('span', { className: 'dsh-mb-hint' }, t('confirmRemoveQuestion')),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-mb-btn dsh-mb-btn--danger',
                    autoFocus: true,
                    disabled: state.mutating,
                    onClick: () => {
                      void onRemove(image)
                    },
                  },
                  t('confirm'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'dsh-mb-btn', onClick: () => setConfirmRemoveId(null) },
                  t('cancel'),
                ),
              )
            : null,
        )
      }

      const renderActiveStrip = () =>
        h(
          'section',
          { className: 'dsh-mb-section', 'aria-label': t('activeGuide') },
          h(
            'div',
            { className: 'dsh-mb-section-head' },
            h('h2', { className: 'dsh-mb-section-title' }, t('activeGuide')),
            h('p', { className: 'dsh-mb-hint' }, t('activeGuideHint')),
          ),
          pinnedImages.length === 0
            ? h('p', { className: 'dsh-mb-hint' }, t('activeGuideEmpty'))
            : h(
                'div',
                { className: 'dsh-mb-active' },
                pinnedImages.map((image) =>
                  h(
                    'div',
                    { key: image.id, className: 'dsh-mb-active-item' },
                    h(
                      'div',
                      { className: 'dsh-mb-active-thumb' },
                      h(Thumb, { image, alt: image.name }),
                    ),
                    h(
                      'div',
                      { className: 'dsh-mb-active-meta' },
                      h('span', { className: 'dsh-mb-active-name', title: image.name }, image.name),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-mb-btn dsh-mb-btn--icon',
                          title: t('unpinName', { name: image.name }),
                          'aria-label': t('unpinName', { name: image.name }),
                          disabled: state.mutating,
                          onClick: () => {
                            void setPinned(image, false)
                          },
                        },
                        h(IconPinOff, { size: 12 }),
                      ),
                    ),
                    image.tags.length > 0
                      ? h(
                          'div',
                          { className: 'dsh-mb-tags' },
                          image.tags
                            .slice(0, 2)
                            .map((tag) => h('span', { key: tag, className: 'dsh-mb-tag' }, tag)),
                        )
                      : null,
                  ),
                ),
              ),
        )

      const renderGallery = () =>
        h(
          'section',
          { className: 'dsh-mb-section', 'aria-label': t('gallery') },
          h(
            'div',
            { className: 'dsh-mb-section-head' },
            h('h2', { className: 'dsh-mb-section-title' }, t('gallery')),
            h('p', { className: 'dsh-mb-hint' }, imageCountText(t, images.length)),
          ),
          h(
            'div',
            { className: 'dsh-mb-filters', role: 'group', 'aria-label': t('filterLabel') },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-mb-chip',
                'aria-pressed': state.tagFilter === '' ? 'true' : 'false',
                onClick: () => setTagFilter(''),
              },
              h('span', null, t('allTags')),
              h('span', null, String(images.length)),
            ),
            board.allTags.map((tag) =>
              h(
                'button',
                {
                  key: tag,
                  type: 'button',
                  className: 'dsh-mb-chip',
                  'aria-pressed': state.tagFilter === tag ? 'true' : 'false',
                  onClick: () => setTagFilter(state.tagFilter === tag ? '' : tag),
                },
                t('tagChip', { tag, count: countForTag(board, tag) }),
              ),
            ),
          ),
          filtered.length === 0
            ? h('p', { className: 'dsh-mb-hint', role: 'status' }, t('noMatches'))
            : h('ul', { className: 'dsh-mb-grid' }, filtered.map(renderCard)),
        )

      const renderMain = () => {
        if (board === null && state.loading) {
          return h('div', { className: 'dsh-mb-empty' }, h('p', { className: 'dsh-mb-empty-title' }, t('loading')))
        }
        if (board === null) {
          return h(
            'div',
            { className: 'dsh-mb-empty' },
            h(IconImage, { size: 32 }),
            h('p', { className: 'dsh-mb-empty-title' }, t('loadErrorTitle')),
            h('p', { className: 'dsh-mb-empty-body' }, t('loadErrorBody')),
            h('button', { type: 'button', className: 'dsh-mb-btn', onClick: () => void refresh() }, t('retry')),
          )
        }
        if (images.length === 0) {
          return h(
            'div',
            { className: 'dsh-mb-empty' },
            h(IconImage, { size: 32 }),
            h('p', { className: 'dsh-mb-empty-title' }, t('emptyTitle')),
            h('p', { className: 'dsh-mb-empty-body' }, t('emptyBody')),
            h(
              'button',
              { type: 'button', className: 'dsh-mb-btn dsh-mb-btn--primary', onClick: openFilePicker },
              h(IconPlus, { size: 12 }),
              t('addImages'),
            ),
          )
        }
        return h(React.Fragment, null, renderActiveStrip(), renderGallery())
      }

      const header = h(
        'header',
        { className: 'dsh-mb-header' },
        h('h1', { className: 'dsh-mb-title' }, t('panel')),
        h(
          'span',
          { className: 'dsh-mb-sub' },
          `${imageCountText(t, images.length)} · ${pinnedCountText(t, pinnedImages.length)}`,
        ),
        h(
          'div',
          { className: 'dsh-mb-header-actions' },
          h(
            'button',
            { type: 'button', className: 'dsh-mb-btn', disabled: copying, onClick: onCopyBrief },
            copying ? t('copyingBrief') : t('copyBrief'),
          ),
          h(
            'button',
            { type: 'button', className: 'dsh-mb-btn dsh-mb-btn--primary', disabled: state.uploading, onClick: openFilePicker },
            h(IconPlus, { size: 12 }),
            t('addImages'),
          ),
        ),
      )

      const errorBanner =
        state.error !== ''
          ? h(
              'div',
              { className: 'dsh-mb-banner', role: 'alert' },
              h('p', { className: 'dsh-mb-banner-text' }, state.error),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-mb-btn dsh-mb-btn--icon',
                  'aria-label': t('dismiss'),
                  title: t('dismiss'),
                  onClick: clearError,
                },
                h(IconClose, { size: 12 }),
              ),
            )
          : null

      const dropZone = h(
        'div',
        { className: 'dsh-mb-drop', role: 'region', 'aria-label': t('dropZoneLabel') },
        h('p', { className: 'dsh-mb-hint' }, t('dropHint')),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-mb-btn',
            disabled: state.uploading,
            onClick: openFilePicker,
          },
          t('addImages'),
        ),
      )

      const uploads =
        state.uploads.length === 0
          ? null
          : h(
              'section',
              { className: 'dsh-mb-section', 'aria-label': t('uploadsHeading') },
              h(
                'div',
                { className: 'dsh-mb-section-head' },
                h('h2', { className: 'dsh-mb-section-title' }, t('uploadsHeading')),
                h(
                  'button',
                  { type: 'button', className: 'dsh-mb-btn', disabled: state.uploading, onClick: clearUploads },
                  t('clearUploads'),
                ),
              ),
              h(
                'ul',
                { className: 'dsh-mb-uploads' },
                state.uploads.map((entry) =>
                  h(
                    'li',
                    { key: entry.key, className: 'dsh-mb-upload-row', 'data-state': entry.state },
                    h('span', null, entry.message),
                  ),
                ),
              ),
            )

      const pendingBar =
        selectedImage !== null && state.pendingSelectId !== undefined
          ? h(
              'div',
              {
                className: 'dsh-mb-pending',
                role: 'alert',
                onKeyDown: (event) => {
                  if (event.key !== 'Escape') return
                  event.preventDefault()
                  cancelPendingSelect()
                },
              },
              h('span', null, t('discardTitle')),
              h(
                'div',
                { className: 'dsh-mb-pending-actions' },
                h(
                  'button',
                  {
                    ref: discardRef,
                    type: 'button',
                    className: 'dsh-mb-btn dsh-mb-btn--primary',
                    onClick: confirmSelect,
                  },
                  t('discard'),
                ),
                h('button', { type: 'button', className: 'dsh-mb-btn', onClick: cancelPendingSelect }, t('keepEditing')),
              ),
            )
          : null

      const detailsPanel =
        selectedImage === null
          ? null
          : h(
              'aside',
              { className: 'dsh-mb-side', 'aria-label': t('details') },
              pendingBar,
              h(MetadataPanel, {
                key: selectedImage.id,
                image: selectedImage,
                t,
                mutating: state.mutating,
                onClose: () => selectImage(null),
              }),
            )

      return h(
        'section',
        {
          className: 'dsh-mb-page',
          'data-drag': dragActive ? 'true' : 'false',
          'aria-label': t('panel'),
          onDragEnter,
          onDragOver,
          onDragLeave,
          onDrop,
        },
        h('style', null, PAGE_CSS),
        h(
          'div',
          { className: 'dsh-mb-visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
          state.statusText,
        ),
        header,
        errorBanner,
        dropZone,
        uploads,
        h('div', { className: 'dsh-mb-body' }, h('div', { className: 'dsh-mb-main' }, renderMain()), detailsPanel),
        dragActive ? h('div', { className: 'dsh-mb-drop-overlay' }, t('dropOverlay')) : null,
        h('input', {
          ref: fileInputRef,
          type: 'file',
          accept: 'image/*',
          multiple: true,
          className: 'dsh-mb-visually-hidden',
          tabIndex: -1,
          'aria-hidden': 'true',
          onChange: onFileInputChange,
        }),
        h('input', {
          ref: replaceInputRef,
          type: 'file',
          accept: 'image/*',
          className: 'dsh-mb-visually-hidden',
          tabIndex: -1,
          'aria-hidden': 'true',
          onChange: onReplaceInputChange,
        }),
      )
    }

    // ---------------------------------------------------------------------------
    // Composer control
    // ---------------------------------------------------------------------------

    function ReferenceButton(props) {
      const t = getTranslator(props)
      const state = useSyncExternalStore(subscribe, getSnapshot)
      const draft = props.useInput((value) => (value === undefined || value === null ? '' : value.draft || ''))
      const board = state.board
      const imageTotal = board === null ? 0 : board.images.length
      const pinnedCount = board === null ? 0 : board.pinned.length
      const disabled = imageTotal === 0
      const title = disabled ? t('referenceEmpty') : t('referenceInsert')
      return h(
        React.Fragment,
        null,
        h('style', null, REFERENCE_CSS),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-mb-ref-btn',
            'aria-label': title,
            title,
            disabled,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 28,
              padding: '0 10px',
              borderRadius: 999,
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'transparent',
              color: 'var(--dsw-alias-label-secondary)',
              font: 'inherit',
              fontSize: 12,
              lineHeight: 1,
              cursor: disabled ? 'default' : 'pointer',
              whiteSpace: 'nowrap',
            },
            onClick: (event) => {
              const handled = insertReferenceDirective(props.inputActions, draft, pinnedCount, t)
              if (handled) focusComposerEditor(event.currentTarget)
            },
          },
          h(MoodboardIcon, { size: 14 }),
          h('span', null, t('reference')),
        ),
      )
    }

    // ---------------------------------------------------------------------------
    // Plugin entry
    // ---------------------------------------------------------------------------

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES))
        const t = ctx.locale.bind(NS)
        activeTranslate = t

        ctx.effect(() => {
          void refresh()
        })

        ctx.effect(() => () => {
          disposeImageUrls()
        })

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'moodboard',
              order: 20,
              label: () => t('panel'),
            },
            MoodboardIcon,
          ),
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: 'moodboard',
              locale: NS,
            },
            MoodboardPage,
          ),
        )

        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.right',
              id: 'moodboard',
              order: 15,
              locale: NS,
              label: () => t('reference'),
            },
            ReferenceButton,
          ),
        )
      },
    }
  },
})
