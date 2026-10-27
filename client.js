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
  id: 'dsh-moodboard',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useSyncExternalStore } = React

    // ---------------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------------

    const NS = 'moodboard'
    const API_ROOT = '/moodboard/api'
    const REORDER_PATH = '/moodboard/api/images/reorder'
    const BULK_PATH = '/moodboard/api/images/bulk'
    const TAGS_MERGE_PATH = '/moodboard/api/tags/merge'
    const REVISION_PATH = '/moodboard/api/revision'
    /** How often the panel looks for board writes made outside this client. */
    const REVISION_POLL_MS = 3000
    /** A hung revision read must not stall the poll forever. */
    const REVISION_TIMEOUT_MS = 5000
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
    const DRAG_ID_TYPE = 'application/x-moodboard-id'
    const TAG_SUGGESTIONS_ID = 'dsh-mb-tag-suggestions'
    const LIGHTBOX_FOCUSABLE =
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

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

        pasteImage: 'Paste image',
        pastingImage: 'Pasting…',
        pasteHint: 'Paste an image with ⌘V / Ctrl+V anywhere on this page.',
        pasteUnsupported: 'Clipboard paste is unavailable in this browser.',
        pasteFailed: 'Could not read the clipboard: {message}',
        pasteNoImage: 'No image found on the clipboard.',
        pasteFileName: 'pasted-image-{index}.{ext}',

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
        searchLabel: 'Search the gallery',
        searchPlaceholder: 'Search name, tags, notes, source…',
        searchClear: 'Clear search',
        searchResults: 'Showing {shown} of {total}',
        searchNoMatches: 'No images match your search.',
        showMore: 'Show more',
        showMoreLabel: 'Show more images',
        reorderHint: 'Drag a card to reorder the gallery.',
        reorderFilteredHint: 'Clear the tag filter to reorder the gallery.',
        reorderSearchHint: 'Clear the search to reorder the gallery.',
        reorderDone: 'Gallery order saved',
        reorderFailed: 'Could not reorder the gallery: {message}',

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
        lightboxTitle: 'Image preview',
        lightboxOpenLabel: 'Expand {name}',
        lightboxClose: 'Close preview',
        lightboxPrev: 'Previous image',
        lightboxNext: 'Next image',
        lightboxTags: 'Tags',
        lightboxNotes: 'Notes',
        lightboxSource: 'Source',

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

        selectionToolbar: 'Selection actions',
        selectionCount: '{count} selected',
        selectionHint: '⌘/Ctrl-click to add, Shift-click for a range, ⌘A selects all, Esc clears.',
        selectionCleared: 'Selection cleared',
        clearSelection: 'Clear selection',
        selectAll: 'Select all',
        selectAllLabel: 'Select all visible images',
        invert: 'Invert',
        bulkInvertLabel: 'Invert selection',
        selectionAll: 'Selected {count} images',
        selectionInverted: 'Selection inverted — {count} selected',
        bulkPinLabel: 'Pin selected images',
        bulkUnpinLabel: 'Unpin selected images',
        bulkPinned: 'Pinned selection ({count})',
        bulkUnpinned: 'Unpinned selection ({count})',
        bulkAddTagLabel: 'Add a tag to the selected images',
        bulkTagPlaceholder: 'Tag to add, then Enter',
        bulkTagged: 'Added tag “{tag}” to the selection ({count})',
        bulkRemoveLabel: 'Remove selected images',
        bulkConfirmQuestion: 'Remove the selected images ({count})?',
        bulkRemoved: 'Removed selection ({count})',
        bulkFailed: 'Bulk action failed: {message}',

        manageTags: 'Manage tags',
        moveLeft: 'Move left',
        moveRight: 'Move right',
        moveLeftLabel: 'Move {name} left',
        moveRightLabel: 'Move {name} right',
        reorderCancelled: 'Reorder cancelled',
        dropEnd: 'Drop to move to the end',
        shortcutsOpenLabel: 'Keyboard shortcuts',
        shortcutsTitle: 'Keyboard shortcuts',
        shortcutsClose: 'Close keyboard shortcuts',
        shortcutPaste: 'Paste images from the clipboard',
        shortcutSearch: 'Focus the gallery search',
        shortcutSelectAll: 'Select all visible images',
        shortcutInvert: 'Invert the selection',
        shortcutReorder: 'Move the focused card (no filter active)',
        shortcutLightbox: 'Previous / next in the lightbox',
        shortcutEscape: 'Clear the selection or close an overlay',
        shortcutHelp: 'Open this shortcuts list',
        tagMergeList: 'Tags on this board',
        tagMergeSelect: 'Select the tag {tag} to merge',
        tagMergeTo: 'New tag name',
        tagMergePlaceholder: 'Type the new tag name',
        tagMergeAction: 'Merge',
        tagMergeBusy: 'Merging…',
        tagMergeHint: 'The selected tag is replaced by the new name on every image.',
        tagMergeEmpty: 'There are no tags to manage yet.',
        tagMergeDone: 'Merged “{from}” into “{to}” — {count} updated.',
        tagMergeFailed: 'Could not merge tags: {message}',
        tagMergeClose: 'Close tag manager',
        tagMergeTitle: 'Merge tags',
        editDetails: 'Edit details',

        galleryDropHint: 'Drag images anywhere, or paste with ⌘V',
        emptyDragHint: 'or drop image files anywhere on this page',
        lightboxHint: '← → to browse · Esc to close',
        detailsKicker: 'Reference',
        historyClear: 'Dismiss upload messages',

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

        copyMetadata: 'Copy tags & notes',
        pasteMetadata: 'Paste copied metadata',
        metadataCopied: 'Copied tags, notes and source',
        metadataPasted: 'Pasted tags, notes and source — save to apply',
        metadataPasteEmpty: 'Copy an image’s metadata first',
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

        pasteImage: '粘贴图片',
        pastingImage: '粘贴中…',
        pasteHint: '在本页任意位置按 ⌘V / Ctrl+V 即可粘贴图片。',
        pasteUnsupported: '当前浏览器不支持从剪贴板粘贴。',
        pasteFailed: '无法读取剪贴板：{message}',
        pasteNoImage: '剪贴板中没有图片。',
        pasteFileName: '粘贴的图片-{index}.{ext}',

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
        searchLabel: '搜索图片库',
        searchPlaceholder: '搜索名称、标签、备注、来源…',
        searchClear: '清除搜索',
        searchResults: '显示 {shown} / {total} 张',
        searchNoMatches: '没有与搜索匹配的图片。',
        showMore: '显示更多',
        showMoreLabel: '显示更多图片',
        reorderHint: '拖动卡片即可调整图片库顺序。',
        reorderFilteredHint: '清除标签筛选后即可调整图片库顺序。',
        reorderSearchHint: '清除搜索后即可调整图片库顺序。',
        reorderDone: '已保存图片库顺序',
        reorderFailed: '无法调整图片库顺序：{message}',

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
        lightboxTitle: '图片预览',
        lightboxOpenLabel: '放大查看 {name}',
        lightboxClose: '关闭预览',
        lightboxPrev: '上一张图片',
        lightboxNext: '下一张图片',
        lightboxTags: '标签',
        lightboxNotes: '备注',
        lightboxSource: '来源',

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

        selectionToolbar: '所选图片操作',
        selectionCount: '已选择 {count} 张',
        selectionHint: '⌘/Ctrl 点击可多选，Shift 点击选择范围，⌘A 全选，Esc 清除选择。',
        selectionCleared: '已清除选择',
        clearSelection: '清除选择',
        selectAll: '全选',
        selectAllLabel: '选择所有当前显示的图片',
        invert: '反选',
        bulkInvertLabel: '反选当前选择',
        selectionAll: '已选择 {count} 张图片',
        selectionInverted: '已反选，当前选择 {count} 张',
        bulkPinLabel: '钉选所选图片',
        bulkUnpinLabel: '取消钉选所选图片',
        bulkPinned: '已钉选所选图片（{count}）',
        bulkUnpinned: '已取消钉选所选图片（{count}）',
        bulkAddTagLabel: '为所选图片添加标签',
        bulkTagPlaceholder: '输入要添加的标签后按回车',
        bulkTagged: '已为所选图片添加标签“{tag}”（{count}）',
        bulkRemoveLabel: '移除所选图片',
        bulkConfirmQuestion: '移除所选的图片（{count} 张）？',
        bulkRemoved: '已移除所选图片（{count}）',
        bulkFailed: '批量操作失败：{message}',

        manageTags: '管理标签',
        moveLeft: '左移',
        moveRight: '右移',
        moveLeftLabel: '将 {name} 左移',
        moveRightLabel: '将 {name} 右移',
        reorderCancelled: '已取消排序',
        dropEnd: '拖到此处移到末尾',
        shortcutsOpenLabel: '键盘快捷键',
        shortcutsTitle: '键盘快捷键',
        shortcutsClose: '关闭快捷键列表',
        shortcutPaste: '从剪贴板粘贴图片',
        shortcutSearch: '聚焦图片库搜索',
        shortcutSelectAll: '全选当前显示的图片',
        shortcutInvert: '反选',
        shortcutReorder: '移动当前聚焦的卡片（无筛选时）',
        shortcutLightbox: '在预览中切换上一张 / 下一张',
        shortcutEscape: '清除选择或关闭浮层',
        shortcutHelp: '打开本快捷键列表',
        tagMergeList: '灵感板上的标签',
        tagMergeSelect: '选择要合并的标签 {tag}',
        tagMergeTo: '新标签名称',
        tagMergePlaceholder: '输入新的标签名称',
        tagMergeAction: '合并',
        tagMergeBusy: '合并中…',
        tagMergeHint: '所选标签会在所有图片上被新名称替换。',
        tagMergeEmpty: '还没有可管理的标签。',
        tagMergeDone: '已将“{from}”合并到“{to}”——已更新 {count}。',
        tagMergeFailed: '无法合并标签：{message}',
        tagMergeClose: '关闭标签管理',
        tagMergeTitle: '合并标签',
        editDetails: '编辑详情',

        galleryDropHint: '将图片拖到任意位置，或按 ⌘V 粘贴',
        emptyDragHint: '也可以将图片文件拖到本页任意位置',
        lightboxHint: '← → 浏览 · Esc 关闭',
        detailsKicker: '参考图',
        historyClear: '清除上传消息',

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

        copyMetadata: '复制标签和备注',
        pasteMetadata: '粘贴已复制的元数据',
        metadataCopied: '已复制标签、备注和来源',
        metadataPasted: '已粘贴标签、备注和来源——保存后生效',
        metadataPasteEmpty: '请先复制一张图片的元数据',
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

    function isImageType(type) {
      return typeof type === 'string' && type.indexOf('image/') === 0
    }

    /** True when paste/selection shortcuts should be left to the focused field. */
    function isEditableTarget(target) {
      if (target === null || target === undefined || typeof target !== 'object') return false
      const tagName = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : ''
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true
      if (target.isContentEditable === true) return true
      if (typeof target.closest === 'function') {
        try {
          if (target.closest('[contenteditable="true"], [role="textbox"]') !== null) return true
        } catch (error) {
          // A detached or exotic node cannot be inspected; treat it as safe.
        }
      }
      return false
    }

    function extensionForMime(type) {
      if (typeof type !== 'string') return 'png'
      const slash = type.indexOf('/')
      if (slash === -1) return 'png'
      const subtype = type
        .slice(slash + 1)
        .split('+')[0]
        .replace(/[^a-z0-9]/gi, '')
        .toLowerCase()
      return subtype === '' ? 'png' : subtype
    }

    /** Image files carried by a `paste` event's clipboardData (files, then items). */
    function clipboardImageFiles(clipboardData) {
      const files = []
      if (clipboardData === null || clipboardData === undefined) return files
      try {
        const list = clipboardData.files
        if (list !== null && list !== undefined && typeof list.length === 'number') {
          for (let index = 0; index < list.length; index += 1) {
            const file = list[index]
            if (file !== null && file !== undefined && isImageType(file.type)) files.push(file)
          }
        }
      } catch (error) {
        // Fall through to clipboard items.
      }
      if (files.length > 0) return files
      try {
        const items = clipboardData.items
        if (items !== null && items !== undefined && typeof items.length === 'number') {
          for (let index = 0; index < items.length; index += 1) {
            const item = items[index]
            if (item === null || item === undefined || item.kind !== 'file' || !isImageType(item.type)) continue
            if (typeof item.getAsFile !== 'function') continue
            const file = item.getAsFile()
            if (file !== null && file !== undefined) files.push(file)
          }
        }
      } catch (error) {
        // Nothing readable on this clipboard.
      }
      return files
    }

    /**
     * Read image blobs through the async Clipboard API (`navigator.clipboard.read`).
     * Throws with code `paste-unsupported` when the API is missing; otherwise the
     * caller shows the localized read error.
     */
    async function readClipboardImageFiles(t) {
      const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
      if (clipboard === undefined || clipboard === null || typeof clipboard.read !== 'function') {
        throw createError(t('pasteUnsupported'), 'paste-unsupported')
      }
      const items = await clipboard.read()
      const files = []
      if (!Array.isArray(items)) return files
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        if (item === null || item === undefined || !Array.isArray(item.types)) continue
        for (const type of item.types) {
          if (!isImageType(type) || typeof item.getType !== 'function') continue
          let blob = null
          try {
            blob = await item.getType(type)
          } catch (error) {
            continue
          }
          if (blob === null || blob === undefined) continue
          const name = t('pasteFileName', { index: files.length + 1, ext: extensionForMime(type) })
          try {
            files.push(new File([blob], name, { type }))
          } catch (error) {
            // Older engines have no File constructor; the blob still uploads.
            files.push(blob)
          }
          break
        }
      }
      return files
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

    /**
     * Gallery order is the manual `order` field only. Pinned images keep their
     * card position (the pinned badge and the active strip are what mark them);
     * this keeps drag-to-reorder stable across pin/unpin changes.
     */
    function sortImages(images) {
      return images.slice().sort((left, right) => {
        if (left.order !== right.order) return left.order - right.order
        const created = String(left.createdAt).localeCompare(String(right.createdAt))
        if (created !== 0) return created
        return String(left.id).localeCompare(String(right.id))
      })
    }

    /**
     * Case-insensitive substring match over every user-visible field of an
     * image. `needle` is expected to be already trimmed and lower-cased.
     */
    function matchesSearch(image, needle) {
      if (needle === '') return true
      const haystack = [image.name, image.tags.join(' '), image.notes, image.sourceUrl, image.id]
      for (const value of haystack) {
        if (String(value).toLowerCase().indexOf(needle) !== -1) return true
      }
      return false
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
      return `${image.id}|${image.imageUrl}`
    }

    // ---------------------------------------------------------------------------
    // Image blob cache (one object URL per image revision, revoked on disposal)
    // ---------------------------------------------------------------------------

    const imageUrlCache = new Map()
    const imageUrlInflight = new Map()
    let liveImageKeys = new Set()
    let disposed = false
    /** Card to focus after a keyboard reorder refresh re-renders the gallery. */
    let pendingCardFocusId = null

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
          if (disposed || !liveImageKeys.has(key)) {
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

    function useImageUrl(image, enabled = true) {
      const key = image === null || image === undefined ? '' : imageKey(image)
      const active = enabled !== false
      const [url, setUrl] = useState(() => (key === '' || !active ? '' : imageUrlCache.get(key) || ''))
      useEffect(() => {
        if (key === '' || !active) {
          if (key === '') setUrl('')
          return undefined
        }
        const cached = imageUrlCache.get(key)
        if (cached !== undefined) {
          setUrl(cached)
          return undefined
        }
        let cancelled = false
        setUrl('')
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
      }, [key, active])
      return url
    }

    /**
     * Track whether an element is near the viewport. Once visible it stays
     * visible, so the wrapped resource is never unloaded again.
     * @returns `[ref, inView]`; without IntersectionObserver it is always true.
     */
    function useInView(enabled) {
      const [inView, setInView] = useState(() => enabled !== true)
      const ref = useRef(null)
      useEffect(() => {
        if (enabled !== true) {
          setInView(true)
          return undefined
        }
        if (inView) return undefined
        const node = ref.current
        if (node === null || node === undefined || typeof IntersectionObserver !== 'function') {
          setInView(true)
          return undefined
        }
        const observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                setInView(true)
                observer.disconnect()
                break
              }
            }
          },
          { rootMargin: '400px 0px' },
        )
        observer.observe(node)
        return () => observer.disconnect()
      }, [enabled, inView])
      return [ref, inView]
    }

    /** Cards rendered before the scroll sentinel loads the next page. */
    const GALLERY_PAGE_SIZE = 36

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
      if (settings.signal !== undefined && settings.signal !== null) init.signal = settings.signal
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
        // Multi-select is tracked separately from the details target: a plain
        // click selects one image, Cmd/Ctrl-click grows or shrinks this set.
        selectedIds: [],
        selectionAnchorId: null,
        tagFilter: '',
        searchQuery: '',
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
    /**
     * Host revision last applied to `snapshot.board`. `null` means "unknown"
     * (the activation read has not succeeded yet), so the next sync retries the
     * full state read.
     */
    let boardRevision = null
    /** Board timestamp last applied; paired with the revision to survive Host reloads. */
    let boardUpdatedAt = null
    /** One revision check at a time; keeps polling from stacking requests. */
    let revisionCheckBusy = false
    /** Cleanup for the foreground poll installed by `startBoardSync`. */
    let boardSyncStop = null

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
      liveImageKeys = new Set(board.images.map(imageKey))
      for (const [key, objectUrl] of imageUrlCache) {
        if (liveImageKeys.has(key)) continue
        URL.revokeObjectURL(objectUrl)
        imageUrlCache.delete(key)
      }
      const current = snapshot.selectedId
      const stillPresent = current !== null && board.images.some((image) => image.id === current)
      const filter = snapshot.tagFilter
      const filterStillPresent = filter !== '' && board.allTags.indexOf(filter) !== -1
      const present = new Set(board.images.map((image) => image.id))
      const selectedIds = snapshot.selectedIds.filter((id) => present.has(id))
      const anchor = snapshot.selectionAnchorId
      setState({
        board,
        loading: false,
        selectedId: stillPresent ? current : null,
        selectedIds,
        selectionAnchorId: anchor !== null && present.has(anchor) ? anchor : null,
        tagFilter: filterStillPresent ? filter : '',
      })
    }

    /** The board timestamp of a raw `/api/state` payload, or `null`. */
    function boardUpdatedAtOf(rawBoard) {
      return rawBoard !== null && typeof rawBoard === 'object' && typeof rawBoard.updatedAt === 'string'
        ? rawBoard.updatedAt
        : null
    }

    /**
     * Re-read the full board. A silent refresh (the poll path) keeps the loaded
     * gallery on screen and ignores transient transport failures; explicit
     * refreshes keep the loading and error states.
     */
    async function refresh(options) {
      const silent = options !== undefined && options !== null && options.silent === true
      refreshToken += 1
      const token = refreshToken
      if (!silent) setState({ loading: true })
      try {
        const payload = await requestJson(`${API_ROOT}/state`)
        if (token !== refreshToken) return
        const recovering = snapshot.board === null
        if (Number.isSafeInteger(payload.revision)) boardRevision = payload.revision
        boardUpdatedAt = boardUpdatedAtOf(payload.board)
        applyBoard(payload.board)
        // A successful read clears the "could not load" banner left behind by an
        // earlier failed activation or retry read.
        if (recovering && snapshot.error !== '') setState({ error: '' })
      } catch (error) {
        if (token !== refreshToken) return
        if (silent) {
          // The poll can take the token from a non-silent refresh that was
          // showing the loading state, so always release that flag here. A
          // missing board still needs the load error.
          const patch = {}
          if (snapshot.loading) patch.loading = false
          if (snapshot.board === null) patch.error = msg('loadFailed', { message: messageOf(error) })
          if (Object.keys(patch).length > 0) setState(patch)
          return
        }
        setState({ loading: false, error: msg('loadFailed', { message: messageOf(error) }) })
      }
    }

    function ensureLoaded() {
      if (snapshot.board === null && !snapshot.loading) void refresh()
    }

    /**
     * Compare the host revision with the one applied to this store and re-read
     * the board only when they differ. Returns whether a refresh was applied.
     * A not-yet-loaded board also retries the initial read, so a panel opened
     * while the Host was still starting recovers on its own.
     */
    async function pullBoardRevision() {
      if (revisionCheckBusy) return false
      revisionCheckBusy = true
      try {
        if (snapshot.loading || snapshot.uploading || snapshot.mutating) return false
        if (snapshot.board === null) {
          await refresh({ silent: true })
          return snapshot.board !== null
        }
        let payload
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        const timer =
          controller !== null && typeof setTimeout === 'function'
            ? setTimeout(() => controller.abort(), REVISION_TIMEOUT_MS)
            : null
        try {
          payload = await requestJson(REVISION_PATH, controller === null ? undefined : { signal: controller.signal })
        } catch (error) {
          return false
        } finally {
          if (timer !== null) clearTimeout(timer)
        }
        // A full refresh may have started meanwhile; it owns the state read and
        // the loading flag, so wait for it instead of superseding it.
        if (snapshot.loading) return false
        const revision = payload !== null && typeof payload === 'object' ? payload.revision : undefined
        // The revision resets when the Host itself reloads, so pair it with the
        // board timestamp: a reload that reads a newer board still refreshes.
        const updatedAt = payload !== null && typeof payload === 'object' ? payload.updatedAt : undefined
        const timestampKnown = typeof updatedAt === 'string' || updatedAt === null
        const revisionChanged = Number.isSafeInteger(revision) && revision !== boardRevision
        const timestampChanged = timestampKnown && updatedAt !== boardUpdatedAt
        if (!revisionChanged && !timestampChanged) return false
        await refresh({ silent: true })
        return true
      } finally {
        revisionCheckBusy = false
      }
    }

    /**
     * Keep the board in sync with writes made outside this client session: an
     * agent adding references through the HTTP API, another window, or a
     * reconnect. Polls one cheap revision read while the document is visible and
     * checks immediately on focus, network recovery and visibility return.
     */
    function startBoardSync() {
      if (boardSyncStop !== null) return boardSyncStop
      const check = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
        void pullBoardRevision()
      }
      const onVisibilityChange = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
        void pullBoardRevision()
      }
      const onForeground = () => {
        void pullBoardRevision()
      }
      const timer = typeof setInterval === 'function' ? setInterval(check, REVISION_POLL_MS) : null
      if (timer !== null && typeof timer === 'object' && typeof timer.unref === 'function') timer.unref()
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)
      if (typeof window !== 'undefined') {
        window.addEventListener('focus', onForeground)
        window.addEventListener('online', onForeground)
      }
      const stop = () => {
        if (timer !== null) clearInterval(timer)
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
        if (typeof window !== 'undefined') {
          window.removeEventListener('focus', onForeground)
          window.removeEventListener('online', onForeground)
        }
        if (boardSyncStop === stop) boardSyncStop = null
      }
      boardSyncStop = stop
      return stop
    }

    function stopBoardSync() {
      if (boardSyncStop !== null) boardSyncStop()
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

    /**
     * Keep the raw text (so multi-word queries can be typed) and trim it when
     * matching: a whitespace-only query counts as empty everywhere.
     */
    function setSearchQuery(value) {
      const next = typeof value === 'string' ? value : ''
      if (snapshot.searchQuery === next) return
      setState({ searchQuery: next })
    }

    function clearSearch() {
      if (snapshot.searchQuery === '') return
      setState({ searchQuery: '' })
    }

    // ---- multi-select ---------------------------------------------------------

    /** Plain click: one focused image, and the details panel follows it. */
    function selectSingleImage(id) {
      setState({ selectedIds: [id], selectionAnchorId: id })
      selectImage(id)
    }

    /** Cmd/Ctrl-click: add or remove one image without dropping the others. */
    function toggleSelectedImage(id) {
      const current = snapshot.selectedIds
      const alreadySelected = current.indexOf(id) !== -1
      const next = alreadySelected ? current.filter((entry) => entry !== id) : current.concat([id])
      setState({ selectedIds: next, selectionAnchorId: id })
      if (!alreadySelected) {
        selectImage(id)
        return
      }
      if (snapshot.selectedId !== id) return
      selectImage(next.length > 0 ? next[next.length - 1] : null)
    }

    /** Shift-click: a contiguous range over the currently visible order. */
    function selectRangeTo(id, visibleIds) {
      const list = Array.isArray(visibleIds) ? visibleIds : []
      const targetIndex = list.indexOf(id)
      const anchor = snapshot.selectionAnchorId
      const anchorIndex = anchor === null ? -1 : list.indexOf(anchor)
      if (targetIndex === -1 || anchorIndex === -1) {
        selectSingleImage(id)
        return
      }
      const start = Math.min(anchorIndex, targetIndex)
      const end = Math.max(anchorIndex, targetIndex)
      const next = list.slice(start, end + 1)
      if (next.length === 0) {
        selectSingleImage(id)
        return
      }
      setState({ selectedIds: next })
      selectImage(id)
    }

    function clearSelection() {
      if (snapshot.selectedIds.length === 0 && snapshot.selectedId === null && snapshot.selectionAnchorId === null) return
      setState({ selectedIds: [], selectionAnchorId: null })
      selectImage(null)
    }

    /** Normalize an id list for select-all/invert. */
    function uniqueIdList(ids) {
      if (!Array.isArray(ids)) return []
      const list = []
      for (const id of ids) {
        if (typeof id !== 'string' || id === '') continue
        if (!list.includes(id)) list.push(id)
      }
      return list
    }

    /** Select every currently visible image (bulk selection; details closed). */
    function selectAllImages(ids) {
      const list = uniqueIdList(ids)
      if (list.length === 0) return 0
      setState({ selectedIds: list, selectionAnchorId: list[list.length - 1] })
      selectImage(null)
      return list.length
    }

    /** Invert the selection over the currently visible images. */
    function invertSelectedImages(ids) {
      const list = uniqueIdList(ids)
      if (list.length === 0) return 0
      const current = new Set(snapshot.selectedIds)
      const next = list.filter((id) => !current.has(id))
      setState({ selectedIds: next, selectionAnchorId: next.length > 0 ? next[next.length - 1] : null })
      selectImage(null)
      return next.length
    }

    /** Close the details panel and drop the card selection with it. */
    function closeDetails() {
      if (snapshot.selectedIds.length !== 0 || snapshot.selectionAnchorId !== null) {
        setState({ selectedIds: [], selectionAnchorId: null })
      }
      selectImage(null)
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

    /**
     * Persist the gallery order. `ids` must list every board image id in its new
     * order (not only the visible/filtered subset).
     */
    async function reorderImages(ids) {
      if (!Array.isArray(ids) || ids.length === 0) return false
      setState({ mutating: true, error: '' })
      try {
        await requestJson(REORDER_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids }),
        })
        setStatus(msg('reorderDone'))
        await refresh()
        return true
      } catch (error) {
        if (errorCode(error) === 'not-found') await refresh()
        setState({ error: msg('reorderFailed', { message: messageOf(error) }) })
        return false
      } finally {
        setState({ mutating: false })
      }
    }

    /**
     * Run one bulk operation over the current multi-selection, then reload the
     * board from `GET /state`. Deleting wins on the Host side; this client sends
     * it alone, never combined with pin/tag fields.
     */
    async function bulkUpdate(patch) {
      const ids = snapshot.selectedIds.slice()
      if (ids.length === 0) return false
      const body = { ids }
      if (patch !== null && typeof patch === 'object') {
        if (patch.pinned !== undefined) body.pinned = patch.pinned === true
        if (Array.isArray(patch.addTags) && patch.addTags.length > 0) body.addTags = patch.addTags
        if (Array.isArray(patch.removeTags) && patch.removeTags.length > 0) body.removeTags = patch.removeTags
        if (patch.delete === true) body.delete = true
      }
      setState({ mutating: true, error: '' })
      try {
        const payload = await requestJson(BULK_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const updated = Number.isFinite(payload.updated) ? payload.updated : ids.length
        const removed = Number.isFinite(payload.removed) ? payload.removed : 0
        if (body.delete === true) {
          setState({ selectedId: null, selectedIds: [], selectionAnchorId: null })
          setStatus(msg('bulkRemoved', { count: removed > 0 ? removed : ids.length }))
        } else if (body.pinned === true) {
          setStatus(msg('bulkPinned', { count: updated }))
        } else if (body.pinned === false) {
          setStatus(msg('bulkUnpinned', { count: updated }))
        } else if (Array.isArray(body.addTags)) {
          setStatus(msg('bulkTagged', { tag: body.addTags[0], count: updated }))
        } else {
          setStatus(msg('selectionCleared'))
        }
        await refresh()
        return true
      } catch (error) {
        if (errorCode(error) === 'not-found') await refresh()
        setState({ error: msg('bulkFailed', { message: messageOf(error) }) })
        return false
      } finally {
        setState({ mutating: false })
      }
    }

    /**
     * Merge `from` into `to` across the whole board. The Host returns the number
     * of images it touched; this resolves with `{ updated }` and reloads the
     * board. Errors are thrown so the dialog can show them inline.
     */
    async function mergeTags(from, to) {
      setState({ mutating: true, error: '' })
      try {
        const payload = await requestJson(TAGS_MERGE_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ from, to }),
        })
        const updated = Number.isFinite(payload.updated) ? payload.updated : 0
        await refresh()
        return { updated }
      } finally {
        setState({ mutating: false })
      }
    }

    // ---- clipboard ------------------------------------------------------------

    /**
     * Tags/notes/source copied out of one image editor and pasted into another.
     * Module-level on purpose: it survives panel remounts, is never persisted,
     * and pasting only fills the editor — the user still has to save.
     */
    let metadataClipboard = null

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
.dsh-mb-page {
  /* Harness-native palette: every surface, border, text and action colour
     comes from DSH theme tokens. The only custom accent is a low-saturation
     warm tint derived from the harness warning token, used sparingly on the
     style-guide surface and pinned affordances. */
  --mb-accent: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 72%, var(--dsw-alias-label-primary));
  --mb-r-sm: 10px;
  --mb-r-md: 14px;
  --mb-r-lg: 20px;
  --mb-ease: cubic-bezier(0.22, 0.68, 0.24, 1);
  --mb-surface: var(--dsw-alias-bg-layer-1);
  --mb-surface-2: var(--dsw-alias-bg-layer-2);
  --mb-line: var(--dsw-alias-settings-card-stroke);
  --mb-line-strong: color-mix(in srgb, var(--dsw-alias-label-tertiary) 62%, transparent);
  --mb-warm-wash: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 5%, var(--dsw-alias-bg-layer-1));
  --mb-shadow-1: 0 1px 2px rgba(0, 0, 0, 0.05), 0 2px 10px -4px rgba(0, 0, 0, 0.08);
  --mb-shadow-2: 0 2px 6px rgba(0, 0, 0, 0.06), 0 16px 34px -20px rgba(0, 0, 0, 0.24);

  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
  padding: 0 clamp(16px, 3vw, 34px) 20px;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* ---------------------------------------------------------------- header */

.dsh-mb-page { width: 100%; max-width: 1680px; margin: 0 auto; }
.dsh-mb-header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; flex: none; padding-top: calc(20px + var(--dsh-frame-top-clearance, 0px)); }
.dsh-mb-head { display: flex; align-items: center; gap: 11px; min-width: 0; }
.dsh-mb-head-icon { display: grid; place-items: center; flex: none; width: 38px; height: 38px; border: 1px solid transparent; border-radius: 12px; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-inverted); box-shadow: var(--mb-shadow-1); }
.dsh-mb-head-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dsh-mb-title { margin: 0; font-size: 21px; font-weight: 650; line-height: 1.15; letter-spacing: -0.018em; }
.dsh-mb-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-mb-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dsh-mb-meta-pill { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px; border: 1px solid var(--mb-line); border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dsh-mb-meta-pill--amber { border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 28%, var(--mb-line)); background: var(--mb-warm-wash); color: var(--dsw-alias-label-primary); }
.dsh-mb-meta-pill--amber svg { color: var(--mb-accent); }
.dsh-mb-header-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-left: auto; }

/* --------------------------------------------------------------- buttons */

.dsh-mb-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 12px; border: 1px solid var(--mb-line); border-radius: var(--mb-r-sm); background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer; transition: background 0.16s var(--mb-ease), border-color 0.16s var(--mb-ease), box-shadow 0.16s var(--mb-ease), transform 0.16s var(--mb-ease); touch-action: manipulation; }
.dsh-mb-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--mb-line-strong); }
.dsh-mb-btn:active:not(:disabled) { transform: translateY(1px); }
.dsh-mb-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.dsh-mb-btn--primary { border-color: transparent; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-inverted); box-shadow: var(--mb-shadow-1); }
.dsh-mb-btn--primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); border-color: transparent; box-shadow: var(--mb-shadow-2); }
.dsh-mb-btn--danger { color: var(--dsw-alias-state-error-primary); }
.dsh-mb-btn--danger:hover:not(:disabled) { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 34%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, var(--mb-surface)); }
.dsh-mb-btn--ghost { border-color: transparent; background: transparent; }
.dsh-mb-btn--ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-mb-btn--icon { width: 32px; padding: 0; }
.dsh-mb-btn--small { height: 28px; padding: 0 10px; font-size: 12px; border-radius: 9px; }
.dsh-mb-btn--small.dsh-mb-btn--icon { width: 28px; padding: 0; }
.dsh-mb-btn-text { display: inline; }

/* ------------------------------------------------------- banners/uploads */

.dsh-mb-banner { display: flex; align-items: flex-start; gap: 10px; flex: none; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent); border-radius: var(--mb-r-sm); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--mb-surface)); }
.dsh-mb-banner-text { flex: 1; min-width: 0; margin: 0; overflow-wrap: anywhere; font-size: 12.5px; }
.dsh-mb-uploads { display: flex; flex-wrap: wrap; gap: 6px; flex: none; margin: 0; padding: 0; list-style: none; }
.dsh-mb-upload-row { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 4px 10px; border: 1px solid var(--mb-line); border-radius: 999px; background: var(--mb-surface); color: var(--dsw-alias-label-secondary); font-size: 11.5px; overflow-wrap: anywhere; }
.dsh-mb-upload-row[data-state='done'] { color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, var(--dsw-alias-label-primary)); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 26%, transparent); }
.dsh-mb-upload-row[data-state='error'] { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent); }
.dsh-mb-uploads-head { display: flex; align-items: center; gap: 8px; flex: none; }

/* ---------------------------------------------------------- page layout */

.dsh-mb-body { display: flex; flex: 1; gap: 18px; min-height: 0; }
.dsh-mb-main { display: flex; flex-direction: column; gap: 18px; flex: 1; min-width: 0; min-height: 0; overflow-y: auto; padding: 2px 4px 12px 0; scrollbar-gutter: stable; }
.dsh-mb-page[data-bulk='true'] .dsh-mb-main { padding-bottom: 78px; }
.dsh-mb-side { display: flex; flex-direction: column; gap: 10px; flex: 0 0 360px; min-width: 0; height: 100%; overflow: hidden; padding-left: 18px; border-left: 1px solid var(--mb-line); }
.dsh-mb-section { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dsh-mb-section-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; min-width: 0; }
.dsh-mb-section-title { margin: 0; font-size: 15px; font-weight: 650; line-height: 22px; letter-spacing: -0.012em; }
.dsh-mb-section-count { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; }
.dsh-mb-section-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-left: auto; }
.dsh-mb-hint { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; overflow-wrap: anywhere; }
.dsh-mb-reorder-hint { display: inline-flex; align-items: center; gap: 4px; opacity: 0.85; }
.dsh-mb-gallery-hint { margin-left: 2px; }
.dsh-mb-no-results { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px 20px; border: 1px dashed var(--mb-line-strong); border-radius: var(--mb-r-md); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); text-align: center; }

/* ---------------------------------------------------- active style guide */

.dsh-mb-hero { position: relative; display: flex; flex-direction: column; gap: 10px; flex: none; overflow: hidden; padding: 14px 16px 15px; border: 1px solid var(--mb-line); border-radius: var(--mb-r-lg); background: linear-gradient(180deg, var(--mb-warm-wash), var(--dsw-alias-bg-layer-1) 72%); color: var(--dsw-alias-label-primary); box-shadow: var(--mb-shadow-1); }
.dsh-mb-hero::after { content: ''; position: absolute; inset: auto 14px 0; height: 1px; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--dsw-alias-state-warn-primary) 30%, transparent), transparent); opacity: 0.5; pointer-events: none; }
.dsh-mb-hero-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; min-width: 0; }
.dsh-mb-hero-title { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--dsw-alias-label-primary); font-size: 15px; font-weight: 650; letter-spacing: -0.012em; }
.dsh-mb-hero-icon { display: grid; place-items: center; width: 26px; height: 26px; border: 1px solid var(--mb-line); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--mb-accent); }
.dsh-mb-hero-badge { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 9px; border: 1px solid var(--mb-line); border-radius: 999px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dsh-mb-hero-badge svg { color: var(--mb-accent); }
.dsh-mb-hero-hint { margin: 0 0 0 auto; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-mb-hero-empty { display: flex; align-items: center; gap: 9px; margin: 0; padding: 12px 14px; border: 1px dashed var(--mb-line-strong); border-radius: 12px; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.dsh-mb-hero-empty svg { color: var(--mb-accent); }
.dsh-mb-active { display: flex; gap: 10px; overflow-x: auto; margin: 0; padding: 2px 2px 6px; scroll-snap-type: x proximity; scrollbar-width: thin; }
.dsh-mb-active-item { display: flex; flex-direction: column; gap: 6px; flex: 0 0 144px; min-width: 0; scroll-snap-align: start; }
.dsh-mb-active-thumb { position: relative; display: block; width: 100%; aspect-ratio: 16 / 10; padding: 0; overflow: hidden; border: 1px solid var(--mb-line); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); cursor: zoom-in; scroll-margin-top: 12px; }
.dsh-mb-active-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform 0.35s var(--mb-ease); }
.dsh-mb-active-thumb:hover img { transform: scale(1.045); }
.dsh-mb-active-meta { display: flex; align-items: center; gap: 4px; min-width: 0; }
.dsh-mb-active-name { flex: 1; min-width: 0; overflow: hidden; color: var(--dsw-alias-label-primary); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }
.dsh-mb-active-unpin { flex: none; width: 24px; height: 24px; border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary); }
.dsh-mb-active-unpin:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }

/* --------------------------------------------------------------- toolbar */

.dsh-mb-toolbar { position: sticky; top: 0; z-index: 6; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 -6px; padding: 8px 6px 9px; border-bottom: 1px solid var(--mb-line); background: color-mix(in srgb, var(--dsw-alias-bg-base) 88%, transparent); backdrop-filter: blur(14px) saturate(1.15); -webkit-backdrop-filter: blur(14px) saturate(1.15); }
.dsh-mb-search { position: relative; display: flex; align-items: center; flex: 1 1 220px; max-width: 320px; min-width: 150px; color: var(--dsw-alias-label-secondary); }
.dsh-mb-search-icon { position: absolute; left: 10px; display: flex; pointer-events: none; opacity: 0.72; }
.dsh-mb-search-input { height: 34px; padding: 0 30px 0 32px; border-radius: var(--mb-r-sm); font-size: 13px; }
.dsh-mb-search-input::-webkit-search-cancel-button, .dsh-mb-search-input::-webkit-search-decoration { -webkit-appearance: none; appearance: none; }
.dsh-mb-search-clear { position: absolute; right: 5px; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dsh-mb-search-clear:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-mb-filters { display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0; padding: 2px 0; overflow-x: auto; scrollbar-width: none; mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - 26px), transparent); -webkit-mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - 26px), transparent); }
.dsh-mb-filters::-webkit-scrollbar { display: none; }
.dsh-mb-chip { display: inline-flex; align-items: center; gap: 6px; flex: none; height: 30px; padding: 0 11px; border: 1px solid var(--mb-line); border-radius: 999px; background: var(--mb-surface); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer; transition: background 0.16s var(--mb-ease), border-color 0.16s var(--mb-ease), color 0.16s var(--mb-ease), box-shadow 0.16s var(--mb-ease); }
.dsh-mb-chip:hover { border-color: var(--mb-line-strong); background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-mb-chip[aria-pressed='true'] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); box-shadow: 0 1px 0 color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent); }
.dsh-mb-chip-count { color: var(--dsw-alias-label-secondary); font-size: 10.5px; font-weight: 500; font-variant-numeric: tabular-nums; opacity: 0.78; }
.dsh-mb-chip--action { border-style: dashed; }

/* ------------------------------------------------------------------ grid */

.dsh-mb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 14px; margin: 0; padding: 0; list-style: none; }
.dsh-mb-card { position: relative; display: flex; flex-direction: column; min-width: 0; overflow: hidden; border: 1px solid var(--mb-line); border-radius: var(--mb-r-md); background: var(--mb-surface); box-shadow: var(--mb-shadow-1); transition: transform 0.2s var(--mb-ease), box-shadow 0.2s var(--mb-ease), border-color 0.2s var(--mb-ease); }
.dsh-mb-card:hover { transform: translateY(-2px); border-color: var(--mb-line-strong); box-shadow: var(--mb-shadow-2); }
.dsh-mb-card:focus-within { border-color: var(--dsw-alias-brand-primary); }
.dsh-mb-card[data-selected='true'] { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 32%, transparent), var(--mb-shadow-2); }
.dsh-mb-card[draggable='true'] { cursor: grab; }
.dsh-mb-card[draggable='true']:active { cursor: grabbing; }
.dsh-mb-card[data-dragging='true'] { opacity: 0.5; transform: scale(0.98); }
.dsh-mb-card[data-drop='before'] { box-shadow: inset 3px 0 0 var(--dsw-alias-brand-primary), var(--mb-shadow-2); }
.dsh-mb-card[data-drop='after'] { box-shadow: inset -3px 0 0 var(--dsw-alias-brand-primary), var(--mb-shadow-2); }
.dsh-mb-thumb-btn { position: relative; display: block; width: 100%; padding: 0; overflow: hidden; border: 0; background: var(--mb-surface-2); aspect-ratio: 4 / 3; cursor: zoom-in; }
.dsh-mb-thumb-btn img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s var(--mb-ease); }
.dsh-mb-card:hover .dsh-mb-thumb-btn img { transform: scale(1.045); }
.dsh-mb-thumb-btn:focus-visible { outline-offset: -3px; }
.dsh-mb-thumb-frame { display: block; position: relative; width: 100%; height: 100%; }
.dsh-mb-thumb-placeholder { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.dsh-mb-pin-badge { position: absolute; top: 8px; left: 8px; z-index: 3; display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 8px; border: 1px solid var(--mb-line); border-radius: 999px; background: var(--dsw-alias-button-floating-fill); color: var(--dsw-alias-label-primary); font-size: 10px; font-weight: 500; line-height: 1; box-shadow: var(--mb-shadow-1); pointer-events: none; }
.dsh-mb-pin-badge svg { color: var(--mb-accent); }
.dsh-mb-card-actions { position: absolute; top: 8px; right: 8px; z-index: 4; display: flex; align-items: center; gap: 2px; padding: 3px; border: 1px solid var(--mb-line); border-radius: 999px; background: var(--dsw-alias-button-floating-fill); box-shadow: var(--mb-shadow-1); opacity: 0; transform: translateY(-4px); transition: opacity 0.16s var(--mb-ease), transform 0.16s var(--mb-ease); }
.dsh-mb-card:hover .dsh-mb-card-actions, .dsh-mb-card:focus-within .dsh-mb-card-actions { opacity: 1; transform: none; }
.dsh-mb-card-actions .dsh-mb-btn { width: 26px; height: 26px; padding: 0; border-color: transparent; border-radius: 50%; background: transparent; color: var(--dsw-alias-label-primary); }
.dsh-mb-card-actions .dsh-mb-btn:hover:not(:disabled) { border-color: transparent; background: var(--dsw-alias-button-floating-hover); }
.dsh-mb-card-actions .dsh-mb-btn--danger { color: var(--dsw-alias-state-error-primary); }
.dsh-mb-card-actions .dsh-mb-btn--danger:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
.dsh-mb-card-meta { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 9px 11px 10px; border-top: 1px solid var(--mb-line); }
.dsh-mb-card-name-row { display: flex; align-items: center; gap: 5px; min-width: 0; }
.dsh-mb-card-check { display: grid; place-items: center; flex: none; width: 15px; height: 15px; border-radius: 50%; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-inverted); }
.dsh-mb-card-name { flex: 1; min-width: 0; overflow: hidden; font-size: 12.5px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.dsh-mb-tags { display: flex; flex-wrap: nowrap; gap: 4px; min-width: 0; min-height: 20px; overflow: hidden; }
.dsh-mb-tag { flex: none; padding: 2px 7px; border: 1px solid transparent; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 10.5px; line-height: 1.4; white-space: nowrap; }
.dsh-mb-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 10px; border-top: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 22%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--mb-surface)); }
.dsh-mb-confirm .dsh-mb-hint { flex: 1 1 100%; }
.dsh-mb-load-more { display: flex; justify-content: center; padding: 8px 0 2px; }
.dsh-mb-drop-end { margin-top: 12px; padding: 14px; border: 1px dashed var(--dsw-alias-brand-primary); border-radius: var(--mb-r-md); background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 12px; text-align: center; }

/* ----------------------------------------------------------------- empty */

.dsh-mb-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; width: 100%; max-width: 620px; min-height: 340px; margin: auto; padding: 48px 28px 44px; border: 1px dashed var(--mb-line-strong); border-radius: var(--mb-r-lg); background: radial-gradient(110% 130% at 50% -10%, var(--mb-warm-wash), transparent 62%), var(--dsw-alias-bg-layer-1); text-align: center; }
.dsh-mb-empty-icon { display: grid; place-items: center; width: 64px; height: 64px; border: 1px solid transparent; border-radius: 20px; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-inverted); box-shadow: var(--mb-shadow-1); }
.dsh-mb-empty-title { margin: 4px 0 0; font-size: 18px; font-weight: 650; letter-spacing: -0.014em; }
.dsh-mb-empty-body { margin: 0; max-width: 430px; color: var(--dsw-alias-label-secondary); font-size: 13px; overflow-wrap: anywhere; }
.dsh-mb-empty-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 6px; }
.dsh-mb-empty-hint { margin: 2px 0 0; color: var(--dsw-alias-label-secondary); font-size: 11.5px; opacity: 0.85; }
.dsh-mb-empty--inline { min-height: 0; margin: 0; padding: 36px 20px; }

/* --------------------------------------------------------------- loading */

.dsh-mb-skeleton-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 14px; }
.dsh-mb-skeleton { height: 196px; border: 1px solid var(--mb-line); border-radius: var(--mb-r-md); background: linear-gradient(100deg, color-mix(in srgb, var(--dsw-alias-label-primary) 4%, var(--dsw-alias-bg-base)) 22%, color-mix(in srgb, var(--dsw-alias-label-primary) 8%, var(--dsw-alias-bg-base)) 42%, color-mix(in srgb, var(--dsw-alias-label-primary) 4%, var(--dsw-alias-bg-base)) 62%); background-size: 220% 100%; animation: dsh-mb-shimmer 1.5s linear infinite; }
.dsh-mb-skeleton--tall { height: 260px; }
@keyframes dsh-mb-shimmer { from { background-position: 120% 0; } to { background-position: -120% 0; } }

/* -------------------------------------------------------------- inspector */

.dsh-mb-details { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; border: 1px solid var(--mb-line); border-radius: var(--mb-r-lg); background: var(--mb-surface); box-shadow: var(--mb-shadow-1); }
.dsh-mb-details-head { display: flex; align-items: center; gap: 8px; flex: none; padding: 11px 14px; border-bottom: 1px solid var(--mb-line); background: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, var(--mb-surface)); }
.dsh-mb-details-heading { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
.dsh-mb-details-kicker { color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.dsh-mb-details-title { flex: 1; min-width: 0; margin: 0; overflow: hidden; font-size: 13.5px; font-weight: 600; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
.dsh-mb-details-body { display: flex; flex-direction: column; gap: 16px; flex: 1 1 auto; min-height: 0; padding: 14px; overflow-y: auto; }
.dsh-mb-details-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; flex: none; padding: 10px 14px; border-top: 1px solid var(--mb-line); background: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, var(--mb-surface)); }
.dsh-mb-details-foot .dsh-mb-btn--primary { margin-left: auto; }
.dsh-mb-details-section { display: flex; flex-direction: column; gap: 8px; }
.dsh-mb-details-section + .dsh-mb-details-section { padding-top: 14px; border-top: 1px solid var(--mb-line); }
.dsh-mb-details-manage { display: flex; flex-direction: column; gap: 8px; padding-top: 14px; border-top: 1px solid var(--mb-line); }
.dsh-mb-details-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dsh-mb-details-actions .dsh-mb-btn { height: 30px; }
.dsh-mb-preview { overflow: hidden; flex: none; border: 1px solid var(--mb-line); border-radius: var(--mb-r-sm); background: var(--dsw-alias-bg-layer-2); }
.dsh-mb-preview img { display: block; width: 100%; max-height: 220px; object-fit: contain; }
.dsh-mb-preview .dsh-mb-thumb-placeholder { height: 150px; }
.dsh-mb-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dsh-mb-label { color: var(--dsw-alias-label-secondary); font-size: 11.5px; font-weight: 500; }
.dsh-mb-input, .dsh-mb-textarea { box-sizing: border-box; width: 100%; height: 34px; padding: 6px 10px; border: 1px solid color-mix(in srgb, var(--dsw-alias-label-secondary) 52%, transparent); border-radius: var(--mb-r-sm); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; transition: border-color 0.15s var(--mb-ease), box-shadow 0.15s var(--mb-ease), background 0.15s var(--mb-ease); }
.dsh-mb-input:hover, .dsh-mb-textarea:hover { border-color: var(--mb-line-strong); }
.dsh-mb-input:focus, .dsh-mb-textarea:focus { outline: none; border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); background: var(--mb-surface); }
.dsh-mb-textarea { min-height: 92px; height: auto; padding: 9px 10px; resize: vertical; line-height: 1.55; }
.dsh-mb-input::placeholder, .dsh-mb-textarea::placeholder { color: var(--dsw-alias-label-secondary); opacity: 0.72; }
.dsh-mb-tag-editor { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dsh-mb-tag-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 4px 3px 9px; border: 1px solid var(--mb-line); border-radius: 999px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-size: 11.5px; }
.dsh-mb-tag-remove { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; }
.dsh-mb-tag-remove:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-mb-tag-add { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
.dsh-mb-tag-add .dsh-mb-input { flex: 1; }
.dsh-mb-switch { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 11px; border: 1px solid var(--mb-line); border-radius: var(--mb-r-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; transition: border-color 0.15s var(--mb-ease), background 0.15s var(--mb-ease); }
.dsh-mb-switch:hover { border-color: var(--mb-line-strong); background: var(--dsw-alias-interactive-bg-hover); }
.dsh-mb-switch-track { position: relative; flex: none; width: 36px; height: 21px; border: 1px solid var(--mb-line-strong); border-radius: 999px; background: var(--mb-surface-2); transition: background 0.18s var(--mb-ease), border-color 0.18s var(--mb-ease); }
.dsh-mb-switch-knob { position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 50%; background: var(--dsw-alias-label-secondary); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.24); transition: transform 0.18s var(--mb-ease), background 0.18s var(--mb-ease); }
.dsh-mb-switch[aria-checked='true'] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dsh-mb-switch[aria-checked='true'] .dsh-mb-switch-track { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); }
.dsh-mb-switch[aria-checked='true'] .dsh-mb-switch-knob { transform: translateX(15px); background: var(--dsw-alias-label-primary-inverted); }
.dsh-mb-switch-text { flex: 1; min-width: 0; }
.dsh-mb-dirty { color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 52%, var(--dsw-alias-label-primary)); font-size: 11.5px; }
.dsh-mb-saved { display: inline-flex; align-items: center; gap: 4px; color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, var(--dsw-alias-label-primary)); font-size: 11.5px; }
.dsh-mb-pending { display: flex; flex-direction: column; gap: 8px; flex: none; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 34%, transparent); border-radius: var(--mb-r-sm); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 9%, var(--mb-surface)); font-size: 12px; }
.dsh-mb-pending-actions { display: flex; justify-content: flex-end; gap: 6px; }
.dsh-mb-link { color: var(--dsw-alias-link); font-weight: 500; overflow-wrap: anywhere; text-decoration: underline; text-decoration-color: color-mix(in srgb, currentColor 42%, transparent); text-underline-offset: 2px; }
.dsh-mb-link:hover { text-decoration-color: currentColor; }
.dsh-mb-visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.dsh-mb-page :focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 4px; }
.dsh-mb-page .dsh-mb-thumb-btn:focus-visible { outline-offset: -3px; border-radius: 0; }
.dsh-mb-page .dsh-mb-card:focus-within { outline: none; }



/* ------------------------------------------------------------------ bulk */

.dsh-mb-bulk { position: fixed; left: 50%; bottom: 22px; z-index: 55; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; max-width: min(880px, calc(100vw - 32px)); padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--dsw-alias-toast-label) 12%, transparent); border-radius: 999px; background: var(--dsw-alias-toast-bg); color: var(--dsw-alias-toast-label); box-shadow: 0 22px 60px -20px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.18); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); transform: translateX(-50%); animation: dsh-mb-rise 0.2s var(--mb-ease); }
@keyframes dsh-mb-rise { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }
.dsh-mb-page:has(.dsh-mb-side) .dsh-mb-bulk { left: calc(50% - 180px); }
.dsh-mb-bulk-count { display: inline-flex; align-items: center; height: 28px; padding: 0 11px; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-toast-label) 16%, transparent); color: var(--dsw-alias-toast-label); font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dsh-mb-bulk-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border: 1px solid transparent; border-radius: 50%; background: transparent; color: var(--dsw-alias-toast-label); cursor: pointer; transition: background 0.15s var(--mb-ease), border-color 0.15s var(--mb-ease); }
.dsh-mb-bulk-btn:hover:not(:disabled) { border-color: color-mix(in srgb, var(--dsw-alias-toast-label) 18%, transparent); background: color-mix(in srgb, var(--dsw-alias-toast-label) 14%, transparent); }
.dsh-mb-bulk-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.dsh-mb-bulk-btn--danger { color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-toast-label)); }
.dsh-mb-bulk-btn--danger:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 28%, transparent); }
.dsh-mb-bulk-tag { display: flex; align-items: center; gap: 4px; }
.dsh-mb-bulk-tag .dsh-mb-input { width: 168px; height: 30px; border-color: color-mix(in srgb, var(--dsw-alias-toast-label) 18%, transparent); border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-toast-label) 10%, transparent); color: var(--dsw-alias-toast-label); font-size: 12px; }
.dsh-mb-bulk-tag .dsh-mb-input::placeholder { color: color-mix(in srgb, var(--dsw-alias-toast-label) 55%, transparent); }
.dsh-mb-bulk-tag .dsh-mb-btn { height: 30px; border-color: color-mix(in srgb, var(--dsw-alias-toast-label) 18%, transparent); border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-toast-label) 10%, transparent); color: var(--dsw-alias-toast-label); }
.dsh-mb-bulk-tag .dsh-mb-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-toast-label) 18%, transparent); border-color: color-mix(in srgb, var(--dsw-alias-toast-label) 28%, transparent); }
.dsh-mb-bulk-hint { flex: 1 1 100%; order: 99; margin: 0; color: color-mix(in srgb, var(--dsw-alias-toast-label) 68%, transparent); font-size: 10.5px; text-align: center; }
.dsh-mb-bulk-error { flex: 1 1 100%; order: 98; margin: 0; color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-toast-label)); font-size: 11px; text-align: center; overflow-wrap: anywhere; }

/* --------------------------------------------------------------- overlays */

.dsh-mb-drop-overlay { position: absolute; inset: 12px; z-index: 80; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; border: 2px dashed color-mix(in srgb, var(--dsw-alias-toast-label) 45%, transparent); border-radius: 22px; background: color-mix(in srgb, var(--dsw-alias-toast-bg) 88%, transparent); color: var(--dsw-alias-toast-label); font-size: 15px; font-weight: 600; text-align: center; backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); pointer-events: none; }
.dsh-mb-drop-overlay-icon { display: grid; place-items: center; width: 58px; height: 58px; border-radius: 20px; background: color-mix(in srgb, var(--dsw-alias-toast-label) 14%, transparent); color: var(--dsw-alias-toast-label); }

/* --------------------------------------------------------------- lightbox */

.dsh-mb-lightbox { position: fixed; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center; padding: 24px; background: color-mix(in srgb, #000 62%, transparent); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); animation: dsh-mb-fade 0.16s var(--mb-ease); }
@keyframes dsh-mb-fade { from { opacity: 0; } to { opacity: 1; } }
.dsh-mb-lightbox-dialog { position: relative; display: flex; flex-direction: column; width: min(960px, 100%); max-height: 100%; min-height: 0; overflow: hidden; border: 1px solid var(--mb-line); border-radius: 20px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); box-shadow: 0 44px 120px -32px rgba(0, 0, 0, 0.62); }
.dsh-mb-lightbox-head { display: flex; align-items: center; gap: 8px; flex: none; padding: 12px 16px; border-bottom: 1px solid var(--mb-line); }
.dsh-mb-lightbox-title { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; margin: 0; overflow: hidden; font-size: 14px; font-weight: 600; line-height: 22px; white-space: nowrap; }
.dsh-mb-lightbox-title > span:first-child + * { overflow: hidden; text-overflow: ellipsis; }
.dsh-mb-lightbox-counter { flex: none; padding: 2px 8px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; }
.dsh-mb-lightbox-actions { display: flex; align-items: center; gap: 6px; flex: none; }
.dsh-mb-lightbox-figure { position: relative; display: flex; flex: 1 1 auto; align-items: center; justify-content: center; min-height: 0; padding: 16px 58px; background: var(--dsw-alias-bg-layer-2); }
.dsh-mb-lightbox-image { display: block; max-width: 100%; max-height: min(58vh, 600px); object-fit: contain; border-radius: 10px; background: #000; box-shadow: var(--mb-shadow-2); }
.dsh-mb-lightbox-figure .dsh-mb-thumb-placeholder { height: 200px; border-radius: 12px; }
.dsh-mb-lightbox-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 38px; height: 38px; border: 1px solid var(--mb-line); border-radius: 50%; background: color-mix(in srgb, var(--dsw-alias-bg-base) 82%, transparent); color: var(--dsw-alias-label-primary); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); box-shadow: var(--mb-shadow-1); }
.dsh-mb-lightbox-nav:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-1); border-color: var(--mb-line-strong); }
.dsh-mb-lightbox-prev { left: 10px; }
.dsh-mb-lightbox-next { right: 10px; }
.dsh-mb-lightbox-body { display: flex; flex-direction: column; gap: 10px; flex: none; max-height: 34%; padding: 12px 16px 14px; overflow-y: auto; border-top: 1px solid var(--mb-line); }
.dsh-mb-lightbox-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dsh-mb-lightbox-notes { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 12.5px; }
.dsh-mb-lightbox-hint { flex: none; padding: 7px 16px 9px; border-top: 1px solid var(--mb-line); color: var(--dsw-alias-label-secondary); font-size: 11px; text-align: center; }

/* ------------------------------------------------------------ dialogs */

.dsh-mb-merge-overlay { position: fixed; inset: 0; z-index: 95; display: flex; align-items: center; justify-content: center; padding: 24px; background: color-mix(in srgb, #000 55%, transparent); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); animation: dsh-mb-fade 0.16s var(--mb-ease); }
.dsh-mb-merge-dialog { display: flex; flex-direction: column; width: min(480px, 100%); max-height: min(82vh, 620px); min-height: 0; overflow: hidden; border: 1px solid var(--mb-line); border-radius: 20px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); box-shadow: 0 40px 110px -30px rgba(0, 0, 0, 0.6); }
.dsh-mb-merge-head { display: flex; align-items: center; gap: 8px; flex: none; padding: 14px 16px; border-bottom: 1px solid var(--mb-line); }
.dsh-mb-merge-title { flex: 1; min-width: 0; margin: 0; font-size: 15px; font-weight: 650; line-height: 22px; letter-spacing: -0.01em; }
.dsh-mb-merge-body { display: flex; flex-direction: column; gap: 12px; flex: 1 1 auto; min-height: 0; padding: 16px; overflow-y: auto; }
.dsh-mb-merge-list { display: flex; flex-wrap: wrap; gap: 6px; max-height: 220px; overflow-y: auto; padding: 2px; }
.dsh-mb-merge-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; }
.dsh-mb-merge-error { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; overflow-wrap: anywhere; }
.dsh-mb-shortcut-list { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.dsh-mb-shortcut-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 7px 2px; border-bottom: 1px solid var(--mb-line); font-size: 12.5px; }
.dsh-mb-shortcut-row:last-child { border-bottom: 0; }
.dsh-mb-shortcut-key { flex: none; padding: 3px 8px; border: 1px solid var(--mb-line); border-radius: 7px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; white-space: nowrap; }

/* --------------------------------------------------------------- composer */

.dsh-mb-ref-btn { transition: background 0.15s var(--mb-ease), border-color 0.15s var(--mb-ease), color 0.15s var(--mb-ease); }
.dsh-mb-ref-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--mb-line-strong); color: var(--dsw-alias-label-primary); }
.dsh-mb-ref-btn:disabled { opacity: 0.5; cursor: default; }
.dsh-mb-ref-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }

/* ------------------------------------------------------------ responsive */

@media (max-width: 1100px) {
  .dsh-mb-side { flex-basis: 330px; padding-left: 14px; }
  .dsh-mb-grid, .dsh-mb-skeleton-grid { grid-template-columns: repeat(auto-fill, minmax(158px, 1fr)); }
}
@media (max-width: 1024px) {
  .dsh-mb-body { flex-direction: column; overflow-y: auto; }
  .dsh-mb-main { overflow: visible; padding-right: 0; }
  .dsh-mb-side { position: fixed; left: 12px; right: 12px; bottom: 12px; z-index: 70; height: auto; max-height: 86vh; padding-left: 0; border-left: 0; }
  .dsh-mb-side::before { content: ''; position: fixed; inset: 0; z-index: -1; background: color-mix(in srgb, #000 34%, transparent); pointer-events: none; }
  .dsh-mb-details { max-height: 86vh; border-radius: 20px; box-shadow: 0 32px 90px -24px rgba(0, 0, 0, 0.55); }
  .dsh-mb-hero-hint { flex-basis: 100%; margin-left: 0; }
  .dsh-mb-bulk { left: 12px; right: 12px; bottom: 12px; max-width: none; transform: none; border-radius: 18px; justify-content: center; }
  @keyframes dsh-mb-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
}
@media (max-width: 640px) {
  .dsh-mb-page { padding: 0 14px 16px; gap: 12px; }
  .dsh-mb-hero { padding: 12px; }
  .dsh-mb-hero-hint { display: none; }
  .dsh-mb-active-item { flex-basis: 132px; }
  .dsh-mb-title { font-size: 19px; }
  .dsh-mb-head-icon { width: 34px; height: 34px; border-radius: 12px; }
  .dsh-mb-header-actions { width: 100%; margin-left: 0; }
  .dsh-mb-header-actions .dsh-mb-btn { flex: 1 1 auto; }
  .dsh-mb-btn-text { display: none; }
  .dsh-mb-header-actions .dsh-mb-btn--primary .dsh-mb-btn-text { display: inline; }
  .dsh-mb-grid, .dsh-mb-skeleton-grid { grid-template-columns: repeat(auto-fill, minmax(142px, 1fr)); gap: 10px; }
  .dsh-mb-skeleton { height: 168px; }
  .dsh-mb-toolbar { position: static; margin: 0; padding-top: 0; background: transparent; backdrop-filter: none; -webkit-backdrop-filter: none; }
  .dsh-mb-search { max-width: none; flex-basis: 100%; }
  .dsh-mb-filters { mask-image: none; -webkit-mask-image: none; }
  .dsh-mb-empty { min-height: 280px; padding: 36px 18px 32px; }
  .dsh-mb-lightbox { padding: 0; }
  .dsh-mb-lightbox-dialog { width: 100%; height: 100%; max-height: 100%; border: 0; border-radius: 0; }
  .dsh-mb-lightbox-image { max-height: 50vh; }
  .dsh-mb-lightbox-body { max-height: 38%; }
  .dsh-mb-lightbox-figure { padding: 12px 50px; }
  .dsh-mb-merge-overlay { padding: 0; }
  .dsh-mb-merge-dialog { width: 100%; max-height: 100%; border: 0; border-radius: 0; }
}

@media (hover: none) {
  .dsh-mb-card-actions { opacity: 1; transform: none; }
  .dsh-mb-card-actions .dsh-mb-btn:nth-child(3), .dsh-mb-card-actions .dsh-mb-btn:nth-child(4) { display: none; }
  .dsh-mb-reorder-hint { display: none; }
  .dsh-mb-active-thumb { cursor: pointer; }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-mb-btn, .dsh-mb-chip, .dsh-mb-card, .dsh-mb-thumb-btn img, .dsh-mb-active-thumb img,
  .dsh-mb-card-actions, .dsh-mb-switch-track, .dsh-mb-switch-knob,
  .dsh-mb-search-clear, .dsh-mb-ref-btn, .dsh-mb-bulk, .dsh-mb-lightbox, .dsh-mb-merge-overlay {
    transition: none !important;
    animation: none !important;
  }
  .dsh-mb-skeleton { animation: none !important; }
}
`

    const REFERENCE_CSS = `
.dsh-mb-ref-btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 1; white-space: nowrap; transition: background 0.15s ease-out, border-color 0.15s ease-out, color 0.15s ease-out; }
.dsh-mb-ref-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-mb-ref-btn:disabled { opacity: 0.5; cursor: default; }
.dsh-mb-ref-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .dsh-mb-ref-btn { transition: none; } }
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

    function IconChevron(props) {
      const size = typeof props.size === 'number' ? props.size : 12
      const right = props.direction === 'right'
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': 'true', focusable: 'false' },
        h('path', {
          d: right ? 'M4.5 2.5L8 6l-3.5 3.5' : 'M7.5 2.5L4 6l3.5 3.5',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          fill: 'none',
        }),
      )
    }

    function IconExpand(props) {
      const size = typeof props.size === 'number' ? props.size : 12
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': 'true', focusable: 'false' },
        h('path', {
          d: 'M7 1.5h3.5V5M5 10.5H1.5V7M10.25 1.75L7 5M1.75 10.25L5 7',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          fill: 'none',
        }),
      )
    }

    function IconHelp(props) {
      const size = typeof props.size === 'number' ? props.size : 14
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': 'true', focusable: 'false' },
        h('circle', {
          cx: 6,
          cy: 6,
          r: 4.7,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
        }),
        h('path', {
          d: 'M4.8 4.6c0-.8.6-1.4 1.4-1.4s1.4.5 1.4 1.3c0 .7-.4 1-1 1.4-.5.3-.7.6-.7 1.1',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
        }),
        h('circle', { cx: 5.9, cy: 8.7, r: 0.65, fill: 'currentColor' }),
      )
    }

    function IconSearch(props) {
      const size = typeof props.size === 'number' ? props.size : 14
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': 'true', focusable: 'false' },
        h('circle', { cx: 8.8, cy: 8.8, r: 5.1 }),
        h('path', { d: 'M12.6 12.6L17 17', strokeLinecap: 'round' }),
      )
    }

    function IconClipboard(props) {
      const size = typeof props.size === 'number' ? props.size : 14
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' },
        h('rect', { x: 4.5, y: 4.2, width: 11, height: 13, rx: 2.4 }),
        h('path', { d: 'M7.2 4.2V3.4c0-.8.6-1.4 1.4-1.4h2.8c.8 0 1.4.6 1.4 1.4v.8' }),
        h('path', { d: 'M7.4 9.2h5.2M7.4 12.6h3.4' }),
      )
    }

    function IconCopy(props) {
      const size = typeof props.size === 'number' ? props.size : 14
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' },
        h('rect', { x: 7.5, y: 7.5, width: 8.5, height: 8.5, rx: 2 }),
        h('path', { d: 'M12.5 7.5V5.6A2.1 2.1 0 0 0 10.4 3.5H5.6A2.1 2.1 0 0 0 3.5 5.6v4.8a2.1 2.1 0 0 0 2.1 2.1h1.9' }),
      )
    }

    function IconTrash(props) {
      const size = typeof props.size === 'number' ? props.size : 14
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' },
        h('path', { d: 'M4 6.2h12' }),
        h('path', { d: 'M8 6.2V4.6c0-.8.6-1.4 1.4-1.4h1.2c.8 0 1.4.6 1.4 1.4v1.6' }),
        h('path', { d: 'M5.4 6.2l.8 9.2c.1 1 .9 1.7 1.8 1.7h4c.9 0 1.7-.7 1.8-1.7l.8-9.2' }),
        h('path', { d: 'M8.5 9.5v4.6M11.5 9.5v4.6' }),
      )
    }

    function IconSwap(props) {
      const size = typeof props.size === 'number' ? props.size : 14
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' },
        h('path', { d: 'M4 7.2h9.4M10.8 4.6l2.8 2.6-2.8 2.6' }),
        h('path', { d: 'M16 12.8H6.6M9.2 10.2l-2.8 2.6 2.8 2.6' }),
      )
    }

    function IconCheck(props) {
      const size = typeof props.size === 'number' ? props.size : 12
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' },
        h('path', { d: 'M2.4 6.4l2.4 2.4 4.8-5.2' }),
      )
    }

    function IconTag(props) {
      const size = typeof props.size === 'number' ? props.size : 14
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' },
        h('path', { d: 'M3.5 9.9V4.9c0-.8.6-1.4 1.4-1.4h5c.4 0 .8.2 1 .4l5.3 5.3c.5.5.5 1.4 0 1.9l-4.4 4.4c-.5.5-1.4.5-1.9 0L4 9.9a1.3 1.3 0 0 1-.5-1z' }),
        h('circle', { cx: 7.2, cy: 7.2, r: 1.1, fill: 'currentColor', stroke: 'none' }),
      )
    }

    function IconSparkle(props) {
      const size = typeof props.size === 'number' ? props.size : 14
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 20 20', fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' },
        h('path', { d: 'M9.2 2.6l1.25 3.65L14.1 7.5l-3.65 1.25L9.2 12.4 7.95 8.75 4.3 7.5l3.65-1.25L9.2 2.6z' }),
        h('path', { d: 'M15.1 12.2l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z', opacity: 0.75 }),
      )
    }

    function IconPencil(props) {
      const size = typeof props.size === 'number' ? props.size : 14
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' },
        h('path', { d: 'M12.4 3.6l4 4L7.6 16.4H3.6v-4L12.4 3.6z' }),
        h('path', { d: 'M10.9 5.1l4 4' }),
      )
    }

    // ---------------------------------------------------------------------------
    // Image thumbnail with cached blob URL
    // ---------------------------------------------------------------------------

    function Thumb(props) {
      const lazy = props.lazy === true
      const [frameRef, inView] = useInView(lazy)
      const url = useImageUrl(props.image, lazy ? inView : true)
      const inner =
        url === ''
          ? h('span', { className: 'dsh-mb-thumb-placeholder', 'aria-hidden': 'true' }, h(IconImage, { size: 18 }))
          : h('img', { src: url, alt: props.alt, loading: 'lazy', draggable: 'false' })
      if (!lazy) return inner
      return h('span', { ref: frameRef, className: 'dsh-mb-thumb-frame' }, inner)
    }

    /** Scroll sentinel plus fallback button that reveals the next gallery page. */
    function LoadMore(props) {
      const [ref, inView] = useInView(true)
      useEffect(() => {
        if (inView && props.hasMore) props.onLoadMore()
      }, [inView, props.hasMore, props.onLoadMore])
      if (!props.hasMore) return null
      return h(
        'div',
        { ref, className: 'dsh-mb-load-more' },
        h(
          'button',
          { type: 'button', className: 'dsh-mb-btn', onClick: props.onLoadMore, 'aria-label': props.label },
          props.text,
        ),
      )
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
      // Mirrors the module-level metadataClipboard so the Paste button reflects
      // a copy made in this session without needing a store round-trip.
      const [clipboardReady, setClipboardReady] = useState(() => metadataClipboard !== null)
      const [metaStatus, setMetaStatus] = useState('')
      const replaceInputRef = useRef(null)
      const savedImageRef = useRef(image)
      const dirtyRef = useRef(false)
      const savingRef = useRef(false)
      const savedTimer = useRef(null)
      const metaStatusTimer = useRef(null)

      const savedImage = savedImageRef.current
      const dirty =
        name !== savedImage.name ||
        notes !== savedImage.notes ||
        sourceUrl !== savedImage.sourceUrl ||
        pinned !== savedImage.pinned ||
        tags.length !== savedImage.tags.length ||
        tags.some((tag, index) => tag !== savedImage.tags[index])

      dirtyRef.current = dirty
      savingRef.current = saving

      function loadFromImage(next) {
        savedImageRef.current = next
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

      useEffect(() => {
        if (metaStatus === '') return undefined
        metaStatusTimer.current = setTimeout(() => setMetaStatus(''), 2400)
        return () => {
          if (metaStatusTimer.current !== null) clearTimeout(metaStatusTimer.current)
          metaStatusTimer.current = null
        }
      }, [metaStatus])

      const copyMetadata = () => {
        metadataClipboard = { tags: tags.slice(), notes, sourceUrl }
        setClipboardReady(true)
        setMetaStatus(t('metadataCopied'))
      }

      const pasteMetadata = () => {
        const clipboard = metadataClipboard
        if (clipboard === null) return
        const nextTags = []
        if (Array.isArray(clipboard.tags)) {
          for (const tag of clipboard.tags) {
            if (typeof tag !== 'string') continue
            const trimmed = tag.trim()
            if (trimmed === '' || trimmed.length > MAX_TAG_LENGTH) continue
            if (nextTags.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) continue
            nextTags.push(trimmed)
            if (nextTags.length >= MAX_TAGS) break
          }
        }
        setTags(nextTags)
        setNotes(stringOr(clipboard.notes, notes).slice(0, MAX_NOTES_LENGTH))
        setSourceUrl(stringOr(clipboard.sourceUrl, sourceUrl).slice(0, MAX_SOURCE_URL_LENGTH))
        setTagInput('')
        setTagError('')
        setMetaStatus(t('metadataPasted'))
      }

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
          h(
            'div',
            { className: 'dsh-mb-details-heading' },
            h('span', { className: 'dsh-mb-details-kicker' }, t('detailsKicker')),
            h('h2', { className: 'dsh-mb-details-title', title: image.name }, image.name),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mb-btn dsh-mb-btn--icon dsh-mb-btn--ghost',
              'aria-label': t('closeDetails'),
              title: t('closeDetails'),
              onClick: props.onClose,
            },
            h(IconClose, { size: 13 }),
          ),
        ),
        h(
          'div',
          { className: 'dsh-mb-details-body' },
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
              list: TAG_SUGGESTIONS_ID,
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
          'div',
          { className: 'dsh-mb-details-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mb-btn',
              disabled: saving,
              title: t('copyMetadata'),
              'aria-label': t('copyMetadata'),
              onClick: copyMetadata,
            },
            t('copyMetadata'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mb-btn',
              disabled: saving || !clipboardReady,
              title: clipboardReady ? t('pasteMetadata') : t('metadataPasteEmpty'),
              'aria-label': clipboardReady ? t('pasteMetadata') : t('metadataPasteEmpty'),
              onClick: pasteMetadata,
            },
            t('pasteMetadata'),
          ),
          metaStatus !== '' ? h('span', { className: 'dsh-mb-saved', role: 'status' }, metaStatus) : null,
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
              className: 'dsh-mb-btn dsh-mb-btn--icon',
              disabled: saving || removing || props.mutating || !props.canMove,
              title: t('moveLeftLabel', { name: image.name }),
              'aria-label': t('moveLeftLabel', { name: image.name }),
              onClick: () => props.onMove(-1),
            },
            h(IconChevron, { size: 12, direction: 'left' }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mb-btn dsh-mb-btn--icon',
              disabled: saving || removing || props.mutating || !props.canMove,
              title: t('moveRightLabel', { name: image.name }),
              'aria-label': t('moveRightLabel', { name: image.name }),
              onClick: () => props.onMove(1),
            },
            h(IconChevron, { size: 12, direction: 'right' }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mb-btn',
              disabled: saving || replaceBusy || removing,
              onClick: requestReplace,
            },
            h(IconSwap, { size: 13 }),
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
        ),
        h(
          'div',
          { className: 'dsh-mb-details-foot' },
          saved
            ? h('span', { className: 'dsh-mb-saved', role: 'status' }, h(IconCheck, { size: 11 }), t('saved'))
            : dirty
              ? h('span', { className: 'dsh-mb-dirty' }, t('dirty'))
              : null,
          h(
            'button',
            { type: 'button', className: 'dsh-mb-btn', disabled: saving || !dirty, onClick: onCancel },
            t('cancel'),
          ),
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
        ),
        h('input', {
          ref: replaceInputRef,
          type: 'file',
          'aria-label': t('replace'),
          accept: 'image/*',
          className: 'dsh-mb-visually-hidden',
          tabIndex: -1,
          'aria-hidden': 'true',
          onChange: onReplaceFile,
        }),
      )
    }

    // ---------------------------------------------------------------------------
    // Tag manager / merge dialog
    // ---------------------------------------------------------------------------

    function TagMergeDialog(props) {
      const t = getTranslator(props)
      const board = props.board
      const tags = board === null ? [] : board.allTags.slice().sort((left, right) => left.localeCompare(right))
      const [from, setFrom] = useState('')
      const [to, setTo] = useState('')
      const [busy, setBusy] = useState(false)
      const [status, setStatus] = useState('')
      const [error, setError] = useState('')
      const dialogRef = useRef(null)
      const closeRef = useRef(null)
      const toInputRef = useRef(null)
      const headingId = 'dsh-mb-tag-merge-title'
      const toId = 'dsh-mb-tag-merge-to'

      useEffect(() => {
        const closeButton = closeRef.current
        if (closeButton !== null) closeButton.focus()
        return () => {
          const opener = props.openerRef === null || props.openerRef === undefined ? null : props.openerRef.current
          if (opener !== null && opener !== undefined && opener.isConnected === true) opener.focus()
        }
      }, [])

      // A disabled control (the Merge button while its request is in flight) can
      // drop focus to <body>, where the overlay's own keydown handler never sees
      // the event. Keep Esc working from anywhere while the dialog is mounted;
      // unmounting returns focus to the opener through the effect above.
      useEffect(() => {
        const onDocumentKeyDown = (event) => {
          if (event === null || event === undefined || event.key !== 'Escape') return
          if (event.defaultPrevented) return
          event.preventDefault()
          props.onClose()
        }
        document.addEventListener('keydown', onDocumentKeyDown)
        return () => {
          document.removeEventListener('keydown', onDocumentKeyDown)
        }
      }, [])

      const selectFrom = (tag) => {
        setFrom(tag)
        setTo((current) => (current === '' ? tag : current))
        setStatus('')
        setError('')
        const input = toInputRef.current
        if (input !== null) input.focus()
      }

      const onMerge = async () => {
        if (busy) return
        const source = from.trim()
        const target = to.trim()
        if (source === '' || target === '' || source.toLowerCase() === target.toLowerCase()) return
        setBusy(true)
        setStatus('')
        setError('')
        try {
          const result = await mergeTags(source, target)
          setStatus(t('tagMergeDone', { from: source, to: target, count: imageCountText(t, result.updated) }))
          setFrom('')
        } catch (failure) {
          setError(t('tagMergeFailed', { message: messageOf(failure) }))
        } finally {
          setBusy(false)
          // Disabling the focused Merge button moves focus to <body>; put it
          // back inside the dialog (without stealing it from another field) so
          // Tab and screen readers stay contained.
          const closeButton = closeRef.current
          if (closeButton !== null) {
            const dialog = dialogRef.current
            const active = document.activeElement
            const insideDialog =
              dialog !== null && active !== null && active !== undefined && dialog.contains(active)
            if (!insideDialog) closeButton.focus()
          }
        }
      }

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          props.onClose()
          return
        }
        if (event.key !== 'Tab') return
        const dialog = dialogRef.current
        if (dialog === null) return
        const focusable = []
        dialog.querySelectorAll(LIGHTBOX_FOCUSABLE).forEach((node) => {
          if (node.getClientRects().length > 0) focusable.push(node)
        })
        if (focusable.length === 0) {
          event.preventDefault()
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const active = document.activeElement
        if (event.shiftKey) {
          if (active === first || !dialog.contains(active)) {
            event.preventDefault()
            last.focus()
          }
          return
        }
        if (active === last || !dialog.contains(active)) {
          event.preventDefault()
          first.focus()
        }
      }

      const trimmedTo = to.trim()
      const mergeDisabled = busy || from === '' || trimmedTo === '' || from.toLowerCase() === trimmedTo.toLowerCase()

      return h(
        'div',
        {
          className: 'dsh-mb-merge-overlay',
          onClick: (event) => {
            if (event.target === event.currentTarget) props.onClose()
          },
          onKeyDown,
        },
        h(
          'div',
          {
            ref: dialogRef,
            className: 'dsh-mb-merge-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': headingId,
          },
          h(
            'div',
            { className: 'dsh-mb-merge-head' },
            h('h2', { id: headingId, className: 'dsh-mb-merge-title' }, t('tagMergeTitle')),
            h(
              'button',
              {
                ref: closeRef,
                type: 'button',
                className: 'dsh-mb-btn dsh-mb-btn--icon',
                'aria-label': t('tagMergeClose'),
                title: t('tagMergeClose'),
                onClick: props.onClose,
              },
              h(IconClose, { size: 12 }),
            ),
          ),
          h(
            'div',
            { className: 'dsh-mb-merge-body' },
            tags.length === 0
              ? h('p', { className: 'dsh-mb-hint' }, t('tagMergeEmpty'))
              : h(
                  React.Fragment,
                  null,
                  h('p', { className: 'dsh-mb-hint' }, t('tagMergeHint')),
                  h('span', { className: 'dsh-mb-label' }, t('tagMergeList')),
                  h(
                    'div',
                    { className: 'dsh-mb-merge-list', role: 'group', 'aria-label': t('tagMergeList') },
                    tags.map((tag) =>
                      h(
                        'button',
                        {
                          key: tag,
                          type: 'button',
                          className: 'dsh-mb-chip',
                          'aria-pressed': from === tag ? 'true' : 'false',
                          'aria-label': t('tagMergeSelect', { tag }),
                          title: t('tagMergeSelect', { tag }),
                          onClick: () => selectFrom(tag),
                        },
                        t('tagChip', { tag, count: countForTag(board, tag) }),
                      ),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'dsh-mb-field' },
                    h('label', { className: 'dsh-mb-label', htmlFor: toId }, t('tagMergeTo')),
                    h('input', {
                      ref: toInputRef,
                      id: toId,
                      className: 'dsh-mb-input',
                      type: 'text',
                      value: to,
                      maxLength: MAX_TAG_LENGTH,
                      placeholder: t('tagMergePlaceholder'),
                      onChange: (event) => {
                        setTo(event.currentTarget.value)
                        setStatus('')
                        setError('')
                      },
                      onKeyDown: (event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        void onMerge()
                      },
                    }),
                  ),
                  error !== '' ? h('p', { className: 'dsh-mb-merge-error', role: 'alert' }, error) : null,
                  status !== '' ? h('p', { className: 'dsh-mb-saved', role: 'status' }, status) : null,
                  h(
                    'div',
                    { className: 'dsh-mb-merge-actions' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-mb-btn dsh-mb-btn--primary',
                        disabled: mergeDisabled,
                        'aria-busy': busy ? 'true' : undefined,
                        onClick: () => {
                          void onMerge()
                        },
                      },
                      busy ? t('tagMergeBusy') : t('tagMergeAction'),
                    ),
                    h('button', { type: 'button', className: 'dsh-mb-btn', disabled: busy, onClick: props.onClose }, t('cancel')),
                  ),
                ),
          ),
        ),
      )
    }

    /** Modal list of keyboard shortcuts; Esc/backdrop/close restore the opener. */
    function ShortcutsDialog(props) {
      const t = getTranslator(props)
      const dialogRef = useRef(null)
      const closeRef = useRef(null)
      const headingId = 'dsh-mb-shortcuts-title'
      useEffect(() => {
        const closeButton = closeRef.current
        if (closeButton !== null) closeButton.focus()
        return () => {
          const opener = props.openerRef === null || props.openerRef === undefined ? null : props.openerRef.current
          if (opener !== null && opener !== undefined && opener.isConnected === true) opener.focus()
        }
      }, [])
      useEffect(() => {
        const onDocumentKeyDown = (event) => {
          if (event === null || event === undefined || event.key !== 'Escape') return
          if (event.defaultPrevented) return
          event.preventDefault()
          props.onClose()
        }
        document.addEventListener('keydown', onDocumentKeyDown)
        return () => document.removeEventListener('keydown', onDocumentKeyDown)
      }, [])
      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          props.onClose()
          return
        }
        if (event.key !== 'Tab') return
        const dialog = dialogRef.current
        if (dialog === null) return
        const nodes = Array.prototype.filter.call(
          dialog.querySelectorAll('button, [href], input, select, textarea'),
          (node) => node.disabled !== true && node.getClientRects().length > 0,
        )
        if (nodes.length === 0) return
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        if (event.shiftKey === true && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (event.shiftKey !== true && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
      const rows = [
        ['shortcutPaste', '⌘V / Ctrl+V'],
        ['shortcutSearch', '/'],
        ['shortcutSelectAll', '⌘A / Ctrl+A'],
        ['shortcutInvert', '⌘⇧A / Ctrl+Shift+A'],
        ['shortcutReorder', 'Alt + ← / →'],
        ['shortcutLightbox', '← / →'],
        ['shortcutEscape', 'Esc'],
        ['shortcutHelp', '?'],
      ]
      return h(
        'div',
        {
          className: 'dsh-mb-merge-overlay',
          onClick: (event) => {
            if (event.target === event.currentTarget) props.onClose()
          },
          onKeyDown,
        },
        h(
          'div',
          {
            ref: dialogRef,
            className: 'dsh-mb-merge-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': headingId,
          },
          h(
            'div',
            { className: 'dsh-mb-merge-head' },
            h('h2', { id: headingId, className: 'dsh-mb-merge-title' }, t('shortcutsTitle')),
            h(
              'button',
              {
                ref: closeRef,
                type: 'button',
                className: 'dsh-mb-btn dsh-mb-btn--icon',
                'aria-label': t('shortcutsClose'),
                title: t('shortcutsClose'),
                onClick: props.onClose,
              },
              h(IconClose, { size: 12 }),
            ),
          ),
          h(
            'div',
            { className: 'dsh-mb-merge-body' },
            h(
              'ul',
              { className: 'dsh-mb-shortcut-list' },
              rows.map(([label, key]) =>
                h(
                  'li',
                  { key: label, className: 'dsh-mb-shortcut-row' },
                  h('span', null, t(label)),
                  h('kbd', { className: 'dsh-mb-shortcut-key' }, key),
                ),
              ),
            ),
          ),
        ),
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
      const [pasting, setPasting] = useState(false)
      const [renderLimit, setRenderLimit] = useState(GALLERY_PAGE_SIZE)
      const [confirmRemoveId, setConfirmRemoveId] = useState(null)
      const [reorderDragId, setReorderDragId] = useState(null)
      const [reorderOver, setReorderOver] = useState(null)
      const [bulkTag, setBulkTag] = useState('')
      const [bulkTagError, setBulkTagError] = useState('')
      const [bulkConfirmRemove, setBulkConfirmRemove] = useState(false)
      const [lightboxId, setLightboxId] = useState(null)
      const [mergeOpen, setMergeOpen] = useState(false)
      const [helpOpen, setHelpOpen] = useState(false)
      const dragDepth = useRef(0)
      const fileInputRef = useRef(null)
      const replaceInputRef = useRef(null)
      const replaceTargetRef = useRef(null)
      const discardRef = useRef(null)
      const searchInputRef = useRef(null)
      const lightboxDialogRef = useRef(null)
      const lightboxCloseRef = useRef(null)
      const lightboxOpenerRef = useRef(null)
      const lightboxIdRef = useRef(null)
      const mergeOpenRef = useRef(false)
      const mergeOpenerRef = useRef(null)
      const clickSelectionRef = useRef(null)
      const helpOpenRef = useRef(false)
      const reorderDragIdRef = useRef(null)
      const helpOpenerRef = useRef(null)
      const visibleIdsRef = useRef([])
      mergeOpenRef.current = mergeOpen
      helpOpenRef.current = helpOpen
      reorderDragIdRef.current = reorderDragId

      useEffect(() => {
        ensureLoaded()
        // Opening the panel is a good moment to pick up writes made while it was
        // closed (for example references the agent just added).
        void pullBoardRevision()
      }, [])

      // A new filter, search term or image count starts the gallery at one page.
      useEffect(() => {
        setRenderLimit(GALLERY_PAGE_SIZE)
      }, [state.searchQuery, state.tagFilter, state.board === null ? 0 : state.board.images.length])

      // '?' opens the shortcut list and '/' focuses the gallery search; both
      // stay inert while a field, dialog or the lightbox owns the keyboard.
      useEffect(() => {
        if (helpOpen) return undefined
        const onKey = (event) => {
          if (event === null || event === undefined || event.defaultPrevented) return
          if (event.metaKey === true || event.ctrlKey === true || event.altKey === true) return
          if (mergeOpenRef.current || lightboxIdRef.current !== null) return
          if (isEditableTarget(event.target)) return
          if (event.key === '?') {
            event.preventDefault()
            const opener = document.activeElement
            helpOpenerRef.current = opener === undefined ? null : opener
            setHelpOpen(true)
            return
          }
          if (event.key === '/') {
            event.preventDefault()
            const input = searchInputRef.current
            if (input !== null) input.focus()
          }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [helpOpen])

      // Clipboard paste and the Esc selection shortcut are page-level: they only
      // listen while the Moodboard page is mounted, and never steal keys from a
      // focused field (name/notes/tag inputs, the composer editor, search).
      useEffect(() => {
        const onPaste = (event) => {
          if (event === null || event === undefined) return
          // The tag manager / shortcuts dialogs own the page while open.
          if (mergeOpenRef.current || helpOpenRef.current) return
          const clipboard = event.clipboardData
          if (clipboard === null || clipboard === undefined) return
          if (isEditableTarget(event.target)) return
          const files = clipboardImageFiles(clipboard)
          if (files.length === 0) return
          event.preventDefault()
          void uploadFiles(files)
        }
        const onKeyDown = (event) => {
          if (event === null || event === undefined) return
          if (event.defaultPrevented) return
          const modified = event.metaKey === true || event.ctrlKey === true
          if (modified && event.altKey !== true && (event.key === 'a' || event.key === 'A')) {
            if (mergeOpenRef.current || helpOpenRef.current) return
            if (lightboxIdRef.current !== null) return
            if (isEditableTarget(event.target)) return
            if (getSnapshot().pendingSelectId !== undefined) return
            const ids = visibleIdsRef.current
            if (!Array.isArray(ids) || ids.length === 0) return
            event.preventDefault()
            if (event.shiftKey === true) {
              setStatus(msg('selectionInverted', { count: invertSelectedImages(ids) }))
            } else {
              setStatus(msg('selectionAll', { count: selectAllImages(ids) }))
            }
            return
          }
          if (event.key !== 'Escape') return
          if (reorderDragIdRef.current !== null) {
            event.preventDefault()
            setReorderDragId(null)
            setReorderOver(null)
            setStatus(msg('reorderCancelled'))
            return
          }
          // Dialog overlays own Esc while they are open (their handlers close them).
          if (mergeOpenRef.current || helpOpenRef.current) return
          // The lightbox owns Esc while it is open (its own handler closes it).
          if (lightboxIdRef.current !== null) return
          if (isEditableTarget(event.target)) return
          const current = getSnapshot()
          if (current.pendingSelectId !== undefined) {
            event.preventDefault()
            cancelPendingSelect()
            return
          }
          if (current.selectedIds.length === 0 && current.selectedId === null) return
          event.preventDefault()
          clearSelection()
          setStatus(msg('selectionCleared'))
        }
        document.addEventListener('paste', onPaste)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('paste', onPaste)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [])

      useEffect(() => {
        if (state.selectedIds.length > 0) return
        setBulkConfirmRemove(false)
        setBulkTagError('')
      }, [state.selectedIds.length])

      // Upload confirmations are transient: successful rows disappear after a
      // beat, while failures stay put until the user dismisses them.
      useEffect(() => {
        if (state.uploads.length === 0) return undefined
        if (state.uploads.some((entry) => entry.state !== 'done')) return undefined
        const timer = setTimeout(clearUploads, 4200)
        return () => clearTimeout(timer)
      }, [state.uploads])

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
      // One shared suggestion list feeds both tag inputs; free text stays valid.
      const tagSuggestions =
        board === null ? [] : board.allTags.slice().sort((left, right) => left.localeCompare(right))
      const pinnedImages = images.filter((image) => image.pinned)
      const selectedImage =
        state.selectedId === null ? null : images.find((image) => image.id === state.selectedId) || null
      // Search is trimmed and lower-cased only for matching; the raw text stays
      // in the store so multi-word queries can be typed.
      const searchNeedle = state.searchQuery.trim().toLowerCase()
      const filtered = images.filter((image) => {
        if (state.tagFilter !== '' && !image.tags.some((tag) => tag.toLowerCase() === state.tagFilter.toLowerCase())) {
          return false
        }
        return matchesSearch(image, searchNeedle)
      })
      visibleIdsRef.current = filtered.map((image) => image.id)
      const lightboxImage = lightboxId === null ? null : images.find((image) => image.id === lightboxId) || null
      const lightboxUrl = useImageUrl(lightboxImage)
      // Navigate the visible order; an image hidden by a changed filter still
      // falls back to the full gallery rather than trapping the lightbox.
      const lightboxList =
        lightboxImage === null
          ? []
          : filtered.some((entry) => entry.id === lightboxImage.id)
            ? filtered
            : images

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

      function hasInternalDrag(event) {
        const transfer = event === null || event === undefined ? undefined : event.dataTransfer
        if (transfer === null || transfer === undefined) return false
        const types = transfer.types
        if (types === null || types === undefined) return false
        try {
          for (let index = 0; index < types.length; index += 1) {
            if (types[index] === DRAG_ID_TYPE) return true
          }
        } catch (error) {
          return false
        }
        return false
      }

      // Manual order needs a stable, filter-free list: reordering while a tag
      // filter or search hides cards would silently move unseen images.
      const canReorder =
        state.tagFilter === '' &&
        searchNeedle === '' &&
        filtered.length === images.length &&
        images.length > 1 &&
        !state.mutating

      // The lightbox is page-local and tracks only an id, so opening it keeps
      // the multi-selection and the details target untouched.
      useEffect(() => {
        const wasOpen = lightboxIdRef.current !== null
        lightboxIdRef.current = lightboxId
        if (lightboxId !== null) {
          if (wasOpen) return
          const closeButton = lightboxCloseRef.current
          if (closeButton !== null) closeButton.focus()
          return
        }
        if (!wasOpen) return
        const opener = lightboxOpenerRef.current
        lightboxOpenerRef.current = null
        if (opener !== null && opener.isConnected === true) opener.focus()
      }, [lightboxId])

      // Esc must also close the preview when focus escaped the dialog (for
      // example after a disabled control moved it to <body>); the overlay
      // handler covers the focused-inside case.
      useEffect(() => {
        if (lightboxId === null) return undefined
        const onDocumentKeyDown = (event) => {
          if (event === null || event === undefined || event.key !== 'Escape') return
          if (event.defaultPrevented) return
          event.preventDefault()
          setLightboxId(null)
        }
        document.addEventListener('keydown', onDocumentKeyDown)
        return () => document.removeEventListener('keydown', onDocumentKeyDown)
      }, [lightboxId])

      // A refresh, a removal or a bulk delete can make the open image vanish.
      useEffect(() => {
        if (lightboxId === null || state.board === null) return
        if (!state.board.images.some((image) => image.id === lightboxId)) setLightboxId(null)
      }, [state.board, lightboxId])

      const openLightbox = (image, opener) => {
        lightboxOpenerRef.current = opener === undefined || opener === null ? null : opener
        setLightboxId(image.id)
      }

      const closeLightbox = () => {
        setLightboxId(null)
      }

      const openTagManager = (opener) => {
        mergeOpenerRef.current = opener === undefined || opener === null ? null : opener
        setMergeOpen(true)
      }

      const closeTagManager = () => {
        setMergeOpen(false)
      }

      // Prev/next walk the current tag + search filtered order and wrap.
      const stepLightbox = (delta) => {
        if (lightboxImage === null || lightboxList.length < 2) return
        const index = lightboxList.findIndex((entry) => entry.id === lightboxImage.id)
        if (index === -1) return
        const nextIndex = (index + delta + lightboxList.length) % lightboxList.length
        setLightboxId(lightboxList[nextIndex].id)
      }

      const onLightboxKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          closeLightbox()
          return
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          event.stopPropagation()
          stepLightbox(-1)
          return
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          event.stopPropagation()
          stepLightbox(1)
          return
        }
        if (event.key !== 'Tab') return
        const dialog = lightboxDialogRef.current
        if (dialog === null) return
        const focusable = []
        dialog.querySelectorAll(LIGHTBOX_FOCUSABLE).forEach((node) => {
          if (node.getClientRects().length > 0) focusable.push(node)
        })
        if (focusable.length === 0) {
          event.preventDefault()
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const active = document.activeElement
        if (event.shiftKey) {
          if (active === first || !dialog.contains(active)) {
            event.preventDefault()
            last.focus()
          }
          return
        }
        if (active === last || !dialog.contains(active)) {
          event.preventDefault()
          first.focus()
        }
      }

      /** Read the dragged image id from the internal drag payload. */
      const readDraggedId = (event, fallback) => {
        let draggedId = fallback === undefined ? null : fallback
        const transfer = event.dataTransfer
        if (transfer !== null && transfer !== undefined) {
          try {
            const data = transfer.getData(DRAG_ID_TYPE)
            if (typeof data === 'string' && data !== '') draggedId = data
          } catch (error) {
            // Fall back to the drag-start id kept in state.
          }
        }
        return draggedId
      }

      const onCardDragStart = (event, image) => {
        if (!canReorder) {
          event.preventDefault()
          return
        }
        const transfer = event.dataTransfer
        if (transfer !== null && transfer !== undefined) {
          try {
            transfer.setData(DRAG_ID_TYPE, image.id)
            transfer.setData('text/plain', image.id)
            transfer.effectAllowed = 'move'
          } catch (error) {
            // Some sources disallow custom types; the local id still reorders.
          }
        }
        setReorderDragId(image.id)
        setReorderOver(null)
        setDragActive(false)
      }

      const onCardDragOver = (event, image) => {
        if (!canReorder) return
        if (!hasInternalDrag(event) && reorderDragId === null) return
        event.preventDefault()
        event.stopPropagation()
        const transfer = event.dataTransfer
        if (transfer !== null && transfer !== undefined) transfer.dropEffect = 'move'
        let after = false
        try {
          const rect = event.currentTarget.getBoundingClientRect()
          after = event.clientY > rect.top + rect.height / 2
        } catch (error) {
          after = false
        }
        setReorderOver((previous) => {
          if (previous !== null && previous.id === image.id && previous.after === after) return previous
          return { id: image.id, after }
        })
      }

      const onCardDrop = (event, image) => {
        if (!canReorder) return
        if (!hasInternalDrag(event) && reorderDragId === null) return
        event.preventDefault()
        event.stopPropagation()
        const draggedId = readDraggedId(event, reorderDragId)
        const targetAfter = reorderOver !== null && reorderOver.id === image.id ? reorderOver.after : false
        setReorderDragId(null)
        setReorderOver(null)
        if (draggedId === null || draggedId === undefined || draggedId === image.id) return
        const ids = images.map((entry) => entry.id)
        if (ids.indexOf(draggedId) === -1 || ids.indexOf(image.id) === -1) return
        const without = ids.filter((id) => id !== draggedId)
        const targetIndex = without.indexOf(image.id)
        if (targetIndex === -1) return
        const insertIndex = Math.min(without.length, targetAfter ? targetIndex + 1 : targetIndex)
        const nextIds = without.slice(0, insertIndex).concat([draggedId], without.slice(insertIndex))
        void reorderImages(nextIds)
      }

      const onCardDragEnd = () => {
        setReorderDragId(null)
        setReorderOver(null)
      }

      const onEndDrop = (event) => {
        if (!canReorder) return
        if (!hasInternalDrag(event) && reorderDragId === null) return
        event.preventDefault()
        event.stopPropagation()
        const draggedId = readDraggedId(event, reorderDragId)
        setReorderDragId(null)
        setReorderOver(null)
        if (draggedId === null || draggedId === undefined) return
        const ids = images.map((image) => image.id).filter((id) => id !== draggedId)
        if (!ids.length && images.length <= 1) return
        ids.push(draggedId)
        void reorderImages(ids)
      }

      const onEndDragOver = (event) => {
        if (!canReorder) return
        if (!hasInternalDrag(event) && reorderDragId === null) return
        event.preventDefault()
        event.stopPropagation()
        const transfer = event.dataTransfer
        if (transfer !== null && transfer !== undefined) transfer.dropEffect = 'move'
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
        // A gallery card drag is an internal reorder, never a file upload.
        if (hasInternalDrag(event)) {
          setReorderDragId(null)
          setReorderOver(null)
          return
        }
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

      const onPasteImage = async () => {
        if (pasting || state.uploading) return
        setPasting(true)
        try {
          let files = []
          try {
            files = await readClipboardImageFiles(t)
          } catch (error) {
            setState({
              error:
                errorCode(error) === 'paste-unsupported'
                  ? messageOf(error)
                  : msg('pasteFailed', { message: messageOf(error) }),
            })
            return
          }
          if (files.length === 0) {
            setState({ error: msg('pasteNoImage') })
            return
          }
          await uploadFiles(files)
        } finally {
          setPasting(false)
        }
      }

      const runBulk = async (patch) => {
        if (state.mutating || state.selectedIds.length === 0) return
        const ok = await bulkUpdate(patch)
        if (!ok) return
        setBulkTag('')
        setBulkTagError('')
        setBulkConfirmRemove(false)
      }

      const onAddBulkTag = () => {
        const raw = bulkTag.trim()
        if (raw === '') {
          setBulkTagError(t('tagEmpty'))
          return
        }
        if (raw.length > MAX_TAG_LENGTH) {
          setBulkTagError(t('tagTooLong'))
          return
        }
        setBulkTagError('')
        void runBulk({ addTags: [raw] })
      }

      const onClearSelection = () => {
        setBulkConfirmRemove(false)
        setBulkTag('')
        setBulkTagError('')
        clearSelection()
      }

      const onCardSelect = (event, image) => {
        if (event.metaKey || event.ctrlKey) {
          toggleSelectedImage(image.id)
          return
        }
        if (event.shiftKey) {
          selectRangeTo(
            image.id,
            filtered.map((entry) => entry.id),
          )
          return
        }
        selectSingleImage(image.id)
      }

      const renderBulkToolbar = () => {
        const count = state.selectedIds.length
        if (count < 2) return null
        return h(
          'div',
          { className: 'dsh-mb-bulk', role: 'toolbar', 'aria-label': t('selectionToolbar') },
          h('span', { className: 'dsh-mb-bulk-count', role: 'status' }, t('selectionCount', { count })),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mb-bulk-btn',
              disabled: state.mutating,
              'aria-label': t('bulkPinLabel'),
              title: t('bulkPinLabel'),
              onClick: () => {
                void runBulk({ pinned: true })
              },
            },
            h(IconPin, { size: 14 }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mb-bulk-btn',
              disabled: state.mutating,
              'aria-label': t('bulkUnpinLabel'),
              title: t('bulkUnpinLabel'),
              onClick: () => {
                void runBulk({ pinned: false })
              },
            },
            h(IconPinOff, { size: 14 }),
          ),
          h(
            'div',
            { className: 'dsh-mb-bulk-tag' },
            h('input', {
              className: 'dsh-mb-input',
              type: 'text',
              value: bulkTag,
              maxLength: MAX_TAG_LENGTH,
              list: TAG_SUGGESTIONS_ID,
              placeholder: t('bulkTagPlaceholder'),
              'aria-label': t('bulkAddTagLabel'),
              'aria-describedby': bulkTagError === '' ? undefined : 'dsh-mb-bulk-tag-error',
              'aria-invalid': bulkTagError === '' ? undefined : 'true',
              onChange: (event) => {
                setBulkTag(event.currentTarget.value)
                setBulkTagError('')
              },
              onKeyDown: (event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                onAddBulkTag()
              },
            }),
            h(
              'button',
              { type: 'button', className: 'dsh-mb-btn dsh-mb-btn--small', disabled: state.mutating, onClick: onAddBulkTag },
              h(IconPlus, { size: 11 }),
              t('addTag'),
            ),
          ),
          bulkConfirmRemove
            ? h(
                React.Fragment,
                null,
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-mb-btn dsh-mb-btn--small dsh-mb-btn--danger',
                    autoFocus: true,
                    disabled: state.mutating,
                    onClick: () => {
                      void runBulk({ delete: true })
                    },
                  },
                  t('confirm'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'dsh-mb-btn dsh-mb-btn--small', onClick: () => setBulkConfirmRemove(false) },
                  t('cancel'),
                ),
              )
            : h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-mb-bulk-btn dsh-mb-bulk-btn--danger',
                  disabled: state.mutating,
                  'aria-label': t('bulkRemoveLabel'),
                  title: t('bulkRemoveLabel'),
                  onClick: () => setBulkConfirmRemove(true),
                },
                h(IconTrash, { size: 14 }),
              ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mb-bulk-btn',
              disabled: state.mutating,
              'aria-label': t('bulkInvertLabel'),
              title: t('bulkInvertLabel'),
              onClick: () => {
                setStatus(msg('selectionInverted', { count: invertSelectedImages(filtered.map((image) => image.id)) }))
              },
            },
            h(IconSwap, { size: 14 }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mb-bulk-btn',
              'aria-label': t('clearSelection'),
              title: t('clearSelection'),
              onClick: onClearSelection,
            },
            h(IconClose, { size: 13 }),
          ),
          bulkConfirmRemove
            ? h(
                'p',
                { className: 'dsh-mb-bulk-error', role: 'alert' },
                t('bulkConfirmQuestion', { count }),
              )
            : null,
          bulkTagError !== ''
            ? h('p', { className: 'dsh-mb-bulk-error', id: 'dsh-mb-bulk-tag-error', role: 'alert' }, bulkTagError)
            : null,
          h('p', { className: 'dsh-mb-bulk-hint' }, t('selectionHint')),
        )
      }

      /** Move one card by keyboard and keep focus on it after the refresh. */
      async function moveCardByOffset(imageId, offset) {
        if (!canReorder) {
          setStatus(msg(searchNeedle !== '' ? 'reorderSearchHint' : 'reorderFilteredHint'))
          return
        }
        const ids = images.map((image) => image.id)
        const index = ids.indexOf(imageId)
        const target = index + offset
        if (index === -1 || target < 0 || target >= ids.length) return
        ids.splice(index, 1)
        ids.splice(target, 0, imageId)
        pendingCardFocusId = imageId
        await reorderImages(ids)
      }

      const renderCard = (image) => {
        const selected = state.selectedIds.indexOf(image.id) !== -1
        const confirming = confirmRemoveId === image.id
        const dragging = reorderDragId === image.id
        const dropEdge =
          reorderOver !== null && reorderOver.id === image.id ? (reorderOver.after ? 'after' : 'before') : null
        return h(
          'li',
          {
            key: image.id,
            className: 'dsh-mb-card',
            'data-selected': selected ? 'true' : 'false',
            'data-dragging': dragging ? 'true' : 'false',
            'data-drop': dropEdge === null ? undefined : dropEdge,
            draggable: canReorder,
            onDragStart: canReorder ? (event) => onCardDragStart(event, image) : undefined,
            onDragOver: canReorder ? (event) => onCardDragOver(event, image) : undefined,
            onDrop: canReorder ? (event) => onCardDrop(event, image) : undefined,
            onDragEnd: onCardDragEnd,
          },
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mb-thumb-btn',
              'aria-pressed': selected ? 'true' : 'false',
              'aria-label': t('selectImage', { name: image.name }),
              'aria-keyshortcuts': canReorder ? 'Alt+ArrowLeft Alt+ArrowRight' : undefined,
              ref: (node) => {
                if (node !== null && pendingCardFocusId === image.id) {
                  pendingCardFocusId = null
                  node.focus()
                }
              },
              onKeyDown: (event) => {
                if (event.altKey !== true || event.ctrlKey === true || event.metaKey === true) return
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                event.preventDefault()
                event.stopPropagation()
                void moveCardByOffset(image.id, event.key === 'ArrowLeft' ? -1 : 1)
              },
              onClick: (event) => {
                // Remember the selection on the first click of a possible
                // double-click so opening the lightbox can leave it untouched.
                if (event.detail === 1) {
                  const current = getSnapshot()
                  clickSelectionRef.current = {
                    selectedId: current.selectedId,
                    selectedIds: current.selectedIds.slice(),
                    selectionAnchorId: current.selectionAnchorId,
                    pendingSelectId: current.pendingSelectId,
                  }
                }
                onCardSelect(event, image)
              },
              onDoubleClick: (event) => {
                event.preventDefault()
                event.stopPropagation()
                const restore = clickSelectionRef.current
                clickSelectionRef.current = null
                if (restore !== null) {
                  // Previewing must not select the card or open its details.
                  setState({
                    selectedId: restore.selectedId,
                    selectedIds: restore.selectedIds,
                    selectionAnchorId: restore.selectionAnchorId,
                    pendingSelectId: restore.pendingSelectId,
                  })
                }
                openLightbox(image, event.currentTarget)
              },
            },
            h(Thumb, { image, alt: image.name, lazy: true }),
          ),
          image.pinned
            ? h('span', { className: 'dsh-mb-pin-badge' }, h(IconPin, { size: 10 }), t('pinnedBadge'))
            : null,
          h(
            'div',
            { className: 'dsh-mb-card-actions', 'aria-hidden': 'true' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-mb-btn dsh-mb-btn--icon',
                tabIndex: -1,
                title: t('lightboxOpenLabel', { name: image.name }),
                'aria-label': t('lightboxOpenLabel', { name: image.name }),
                'aria-haspopup': 'dialog',
                onClick: (event) => {
                  // Expanding previews the image without changing the selection.
                  event.stopPropagation()
                  openLightbox(image, event.currentTarget)
                },
              },
              h(IconExpand, { size: 13 }),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-mb-btn dsh-mb-btn--icon',
                tabIndex: -1,
                title: t(image.pinned ? 'unpinName' : 'pinName', { name: image.name }),
                'aria-label': t(image.pinned ? 'unpinName' : 'pinName', { name: image.name }),
                disabled: state.mutating,
                onClick: () => {
                  void setPinned(image, !image.pinned)
                },
              },
              image.pinned ? h(IconPinOff, { size: 13 }) : h(IconPin, { size: 13 }),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-mb-btn dsh-mb-btn--icon',
                tabIndex: -1,
                title: t('replaceLabel', { name: image.name }),
                'aria-label': t('replaceLabel', { name: image.name }),
                disabled: state.mutating,
                onClick: () => requestReplace(image),
              },
              h(IconSwap, { size: 13 }),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-mb-btn dsh-mb-btn--icon dsh-mb-btn--danger',
                tabIndex: -1,
                title: t('removeName', { name: image.name }),
                'aria-label': t('removeName', { name: image.name }),
                disabled: state.mutating,
                onClick: () => setConfirmRemoveId(image.id),
              },
              h(IconTrash, { size: 13 }),
            ),
          ),
          h(
            'div',
            { className: 'dsh-mb-card-meta' },
            h(
              'div',
              { className: 'dsh-mb-card-name-row' },
              selected
                ? h('span', { className: 'dsh-mb-card-check', 'aria-hidden': 'true' }, h(IconCheck, { size: 10 }))
                : null,
              h('span', { className: 'dsh-mb-card-name', title: image.name }, image.name),
            ),
            h(
              'div',
              { className: 'dsh-mb-tags' },
              image.tags.slice(0, 2).map((tag) => h('span', { key: tag, className: 'dsh-mb-tag' }, tag)),
              image.tags.length > 2 ? h('span', { className: 'dsh-mb-tag' }, `+${image.tags.length - 2}`) : null,
            ),
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
          { className: 'dsh-mb-hero', 'aria-label': t('activeGuide') },
          h(
            'div',
            { className: 'dsh-mb-hero-head' },
            h(
              'h2',
              { className: 'dsh-mb-hero-title' },
              h('span', { className: 'dsh-mb-hero-icon', 'aria-hidden': 'true' }, h(IconSparkle, { size: 14 })),
              t('activeGuide'),
            ),
            h(
              'span',
              { className: 'dsh-mb-hero-badge' },
              h(IconPin, { size: 10 }),
              pinnedCountText(t, pinnedImages.length),
            ),
            h('p', { className: 'dsh-mb-hero-hint' }, t('activeGuideHint')),
          ),
          pinnedImages.length === 0
            ? h('p', { className: 'dsh-mb-hero-empty' }, h(IconPin, { size: 14 }), t('activeGuideEmpty'))
            : h(
                'div',
                { className: 'dsh-mb-active' },
                pinnedImages.map((image) =>
                  h(
                    'div',
                    { key: image.id, className: 'dsh-mb-active-item' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-mb-active-thumb',
                        title: t('lightboxOpenLabel', { name: image.name }),
                        'aria-label': t('lightboxOpenLabel', { name: image.name }),
                        'aria-haspopup': 'dialog',
                        onClick: (event) => openLightbox(image, event.currentTarget),
                      },
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
                          className: 'dsh-mb-btn dsh-mb-btn--icon dsh-mb-active-unpin',
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

      const onClearSearch = () => {
        clearSearch()
        const input = searchInputRef.current
        if (input !== null) input.focus()
      }

      const renderGallery = () =>
        h(
          'section',
          { className: 'dsh-mb-section', 'aria-label': t('gallery') },
          h(
            'div',
            { className: 'dsh-mb-section-head' },
            h('h2', { className: 'dsh-mb-section-title' }, t('gallery')),
            h('span', { className: 'dsh-mb-section-count' }, imageCountText(t, filtered.length)),
            searchNeedle === ''
              ? null
              : h(
                  'span',
                  { className: 'dsh-mb-hint', role: 'status' },
                  t('searchResults', { shown: filtered.length, total: images.length }),
                ),
            images.length > 1
              ? h(
                  'span',
                  { className: 'dsh-mb-hint dsh-mb-reorder-hint' },
                  t(canReorder ? 'reorderHint' : searchNeedle === '' ? 'reorderFilteredHint' : 'reorderSearchHint'),
                )
              : null,
            h(
              'div',
              { className: 'dsh-mb-section-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-mb-btn dsh-mb-btn--small',
                  disabled: filtered.length === 0,
                  title: t('selectAllLabel'),
                  'aria-label': t('selectAllLabel'),
                  onClick: () => {
                    setStatus(msg('selectionAll', { count: selectAllImages(filtered.map((image) => image.id)) }))
                  },
                },
                h(IconCheck, { size: 12 }),
                h('span', { className: 'dsh-mb-btn-text' }, t('selectAll')),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-mb-btn dsh-mb-btn--small',
                  'aria-haspopup': 'dialog',
                  title: t('tagMergeTitle'),
                  'aria-label': t('tagMergeTitle'),
                  onClick: (event) => openTagManager(event.currentTarget),
                },
                h(IconTag, { size: 12 }),
                h('span', { className: 'dsh-mb-btn-text' }, t('tagMergeTitle')),
              ),
            ),
          ),
          h(
            'div',
            { className: 'dsh-mb-toolbar' },
            h(
              'div',
              { className: 'dsh-mb-search' },
              h(
                'label',
                { className: 'dsh-mb-visually-hidden', htmlFor: 'dsh-mb-search-input' },
                t('searchLabel'),
              ),
              h('span', { className: 'dsh-mb-search-icon', 'aria-hidden': 'true' }, h(IconSearch, { size: 14 })),
              h('input', {
                ref: searchInputRef,
                id: 'dsh-mb-search-input',
                className: 'dsh-mb-input dsh-mb-search-input',
                type: 'search',
                value: state.searchQuery,
                placeholder: t('searchPlaceholder'),
                autoComplete: 'off',
                spellCheck: false,
                onChange: (event) => setSearchQuery(event.currentTarget.value),
                onKeyDown: (event) => {
                  if (event.key !== 'Escape') return
                  event.preventDefault()
                  event.stopPropagation()
                  onClearSearch()
                },
              }),
              state.searchQuery === ''
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-mb-search-clear',
                      'aria-label': t('searchClear'),
                      title: t('searchClear'),
                      onClick: onClearSearch,
                    },
                    h(IconClose, { size: 10 }),
                  ),
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
                h('span', { className: 'dsh-mb-chip-count' }, String(images.length)),
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
                  h('span', null, tag),
                  h('span', { className: 'dsh-mb-chip-count' }, String(countForTag(board, tag))),
                ),
              ),
            ),
          ),
          filtered.length === 0
            ? h(
                'div',
                { className: 'dsh-mb-no-results', role: 'status' },
                h(IconSearch, { size: 22 }),
                h('p', { className: 'dsh-mb-empty-title' }, t(searchNeedle === '' ? 'noMatches' : 'searchNoMatches')),
              )
            : h(
                React.Fragment,
                null,
                h('ul', { className: 'dsh-mb-grid' }, filtered.slice(0, renderLimit).map(renderCard)),
                canReorder && reorderDragId !== null
                  ? h(
                      'div',
                      {
                        className: 'dsh-mb-drop-end',
                        onDragOver: onEndDragOver,
                        onDrop: onEndDrop,
                      },
                      t('dropEnd'),
                    )
                  : null,
                h(LoadMore, {
                  hasMore: filtered.length > renderLimit,
                  onLoadMore: () => setRenderLimit((limit) => Math.min(limit + GALLERY_PAGE_SIZE, filtered.length)),
                  text: t('showMore'),
                  label: t('showMoreLabel'),
                }),
              ),
        )

      const renderLightbox = () => {
        if (lightboxImage === null) return null
        const headingId = 'dsh-mb-lightbox-title'
        const multi = lightboxList.length > 1
        const position = lightboxList.findIndex((entry) => entry.id === lightboxImage.id)
        return h(
          'div',
          {
            className: 'dsh-mb-lightbox',
            onClick: (event) => {
              if (event.target === event.currentTarget) closeLightbox()
            },
            onKeyDown: onLightboxKeyDown,
          },
          h(
            'div',
            {
              ref: lightboxDialogRef,
              className: 'dsh-mb-lightbox-dialog',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-labelledby': headingId,
            },
            h(
              'div',
              { className: 'dsh-mb-lightbox-head' },
              h(
                'h2',
                { id: headingId, className: 'dsh-mb-lightbox-title' },
                h('span', { className: 'dsh-mb-visually-hidden' }, `${t('lightboxTitle')} `),
                lightboxImage.name,
                multi ? h('span', { className: 'dsh-mb-lightbox-counter' }, `${position + 1} / ${lightboxList.length}`) : null,
              ),
              h(
                'div',
                { className: 'dsh-mb-lightbox-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-mb-btn dsh-mb-btn--small',
                    disabled: state.mutating,
                    title: t('editDetails'),
                    onClick: () => {
                      selectSingleImage(lightboxImage.id)
                      closeLightbox()
                    },
                  },
                  h(IconPencil, { size: 12 }),
                  h('span', { className: 'dsh-mb-btn-text' }, t('editDetails')),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-mb-btn dsh-mb-btn--small',
                    disabled: state.mutating,
                    title: t(lightboxImage.pinned ? 'unpinName' : 'pinName', { name: lightboxImage.name }),
                    'aria-label': t(lightboxImage.pinned ? 'unpinName' : 'pinName', { name: lightboxImage.name }),
                    'aria-pressed': lightboxImage.pinned ? 'true' : 'false',
                    onClick: () => {
                      void setPinned(lightboxImage, !lightboxImage.pinned)
                    },
                  },
                  lightboxImage.pinned ? h(IconPinOff, { size: 12 }) : h(IconPin, { size: 12 }),
                  h('span', { className: 'dsh-mb-btn-text' }, lightboxImage.pinned ? t('unpin') : t('pin')),
                ),
              ),
              h(
                'button',
                {
                  ref: lightboxCloseRef,
                  type: 'button',
                  className: 'dsh-mb-btn dsh-mb-btn--icon',
                  'aria-label': t('lightboxClose'),
                  title: t('lightboxClose'),
                  onClick: closeLightbox,
                },
                h(IconClose, { size: 13 }),
              ),
            ),
            h(
              'div',
              { className: 'dsh-mb-lightbox-figure' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-mb-btn dsh-mb-btn--icon dsh-mb-lightbox-nav dsh-mb-lightbox-prev',
                  'aria-label': t('lightboxPrev'),
                  title: t('lightboxPrev'),
                  disabled: !multi,
                  onClick: () => stepLightbox(-1),
                },
                h(IconChevron, { size: 16, direction: 'left' }),
              ),
              lightboxUrl === ''
                ? h(
                    'span',
                    { className: 'dsh-mb-thumb-placeholder', 'aria-hidden': 'true' },
                    h(IconImage, { size: 18 }),
                  )
                : h('img', {
                    className: 'dsh-mb-lightbox-image',
                    src: lightboxUrl,
                    alt: t('previewAlt', { name: lightboxImage.name }),
                    draggable: 'false',
                  }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-mb-btn dsh-mb-btn--icon dsh-mb-lightbox-nav dsh-mb-lightbox-next',
                  'aria-label': t('lightboxNext'),
                  title: t('lightboxNext'),
                  disabled: !multi,
                  onClick: () => stepLightbox(1),
                },
                h(IconChevron, { size: 16, direction: 'right' }),
              ),
            ),
            h(
              'div',
              { className: 'dsh-mb-lightbox-body' },
              lightboxImage.tags.length === 0
                ? null
                : h(
                    'div',
                    { className: 'dsh-mb-lightbox-field' },
                    h('span', { className: 'dsh-mb-label' }, t('lightboxTags')),
                    h(
                      'div',
                      { className: 'dsh-mb-tags' },
                      lightboxImage.tags.map((tag) => h('span', { key: tag, className: 'dsh-mb-tag' }, tag)),
                    ),
                  ),
              lightboxImage.notes.trim() === ''
                ? null
                : h(
                    'div',
                    { className: 'dsh-mb-lightbox-field' },
                    h('span', { className: 'dsh-mb-label' }, t('lightboxNotes')),
                    h('p', { className: 'dsh-mb-lightbox-notes' }, lightboxImage.notes),
                  ),
              lightboxImage.sourceUrl === ''
                ? null
                : h(
                    'div',
                    { className: 'dsh-mb-lightbox-field' },
                    h('span', { className: 'dsh-mb-label' }, t('lightboxSource')),
                    h(
                      'a',
                      {
                        className: 'dsh-mb-link',
                        href: lightboxImage.sourceUrl,
                        target: '_blank',
                        rel: 'noreferrer noopener',
                      },
                      lightboxImage.sourceUrl,
                    ),
                  ),
            ),
            h('p', { className: 'dsh-mb-lightbox-hint' }, t('lightboxHint')),
          ),
        )
      }

      const renderMain = () => {
        if (board === null && state.loading) {
          return h(
            'div',
            { className: 'dsh-mb-skeleton-grid', role: 'status', 'aria-busy': 'true', 'aria-label': t('loading') },
            Array.from({ length: 8 }, (_, index) => h('div', { key: index, className: 'dsh-mb-skeleton' })),
          )
        }
        if (board === null) {
          return h(
            'div',
            { className: 'dsh-mb-empty' },
            h('div', { className: 'dsh-mb-empty-icon', 'aria-hidden': 'true' }, h(IconImage, { size: 30 })),
            h('p', { className: 'dsh-mb-empty-title' }, t('loadErrorTitle')),
            h('p', { className: 'dsh-mb-empty-body' }, t('loadErrorBody')),
            h(
              'div',
              { className: 'dsh-mb-empty-actions' },
              h(
                'button',
                { type: 'button', className: 'dsh-mb-btn dsh-mb-btn--primary', onClick: () => void refresh() },
                t('retry'),
              ),
            ),
          )
        }
        if (images.length === 0) {
          return h(
            'div',
            { className: 'dsh-mb-empty' },
            h('div', { className: 'dsh-mb-empty-icon', 'aria-hidden': 'true' }, h(IconImage, { size: 30 })),
            h('p', { className: 'dsh-mb-empty-title' }, t('emptyTitle')),
            h('p', { className: 'dsh-mb-empty-body' }, t('emptyBody')),
            h(
              'div',
              { className: 'dsh-mb-empty-actions' },
              h(
                'button',
                { type: 'button', className: 'dsh-mb-btn dsh-mb-btn--primary', onClick: openFilePicker },
                h(IconPlus, { size: 13 }),
                t('addImages'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-mb-btn',
                  disabled: state.uploading || pasting,
                  onClick: () => {
                    void onPasteImage()
                  },
                },
                h(IconClipboard, { size: 14 }),
                pasting ? t('pastingImage') : t('pasteImage'),
              ),
            ),
            h('p', { className: 'dsh-mb-empty-hint' }, t('emptyDragHint')),
          )
        }
        return h(React.Fragment, null, renderActiveStrip(), renderGallery())
      }

      const header = h(
        'header',
        { className: 'dsh-mb-header' },
        h(
          'div',
          { className: 'dsh-mb-head' },
          h('span', { className: 'dsh-mb-head-icon', 'aria-hidden': 'true' }, h(MoodboardIcon, { size: 21 })),
          h(
            'div',
            { className: 'dsh-mb-head-text' },
            h('h1', { className: 'dsh-mb-title' }, t('panel')),
            h(
              'div',
              { className: 'dsh-mb-meta' },
              h('span', { className: 'dsh-mb-meta-pill' }, imageCountText(t, images.length)),
              h(
                'span',
                { className: 'dsh-mb-meta-pill dsh-mb-meta-pill--amber' },
                h(IconPin, { size: 10 }),
                pinnedCountText(t, pinnedImages.length),
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dsh-mb-header-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mb-btn dsh-mb-btn--icon dsh-mb-btn--ghost',
              'aria-label': t('shortcutsOpenLabel'),
              title: t('shortcutsOpenLabel'),
              'aria-haspopup': 'dialog',
              onClick: (event) => {
                helpOpenerRef.current = event.currentTarget
                setHelpOpen(true)
              },
            },
            h(IconHelp, { size: 15 }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mb-btn',
              disabled: copying || images.length === 0,
              'aria-label': t('copyBrief'),
              title: t('copyBrief'),
              onClick: onCopyBrief,
            },
            h(IconCopy, { size: 13 }),
            h('span', { className: 'dsh-mb-btn-text' }, copying ? t('copyingBrief') : t('copyBrief')),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mb-btn',
              disabled: state.uploading || pasting,
              'aria-label': t('pasteImage'),
              title: t('pasteHint'),
              onClick: () => {
                void onPasteImage()
              },
            },
            h(IconClipboard, { size: 14 }),
            h('span', { className: 'dsh-mb-btn-text' }, pasting ? t('pastingImage') : t('pasteImage')),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mb-btn dsh-mb-btn--primary',
              disabled: state.uploading,
              onClick: openFilePicker,
            },
            h(IconPlus, { size: 13 }),
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

      const uploads =
        state.uploads.length === 0
          ? null
          : h(
              'div',
              { className: 'dsh-mb-uploads-head', role: 'region', 'aria-label': t('uploadsHeading') },
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
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-mb-btn dsh-mb-btn--small dsh-mb-btn--ghost',
                  disabled: state.uploading,
                  title: t('clearUploads'),
                  'aria-label': t('clearUploads'),
                  onClick: clearUploads,
                },
                h(IconClose, { size: 11 }),
                h('span', { className: 'dsh-mb-btn-text' }, t('clearUploads')),
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
              'div',
              { className: 'dsh-mb-side', role: 'region', 'aria-label': t('details') },
              pendingBar,
              h(MetadataPanel, {
                key: selectedImage.id,
                image: selectedImage,
                t,
                mutating: state.mutating,
                canMove: canReorder,
                onMove: (offset) => {
                  void moveCardByOffset(selectedImage.id, offset)
                },
                onClose: closeDetails,
              }),
            )

      // One shared suggestion source for every tag input on the page.
      const tagSuggestionList = h(
        'datalist',
        { id: TAG_SUGGESTIONS_ID },
        tagSuggestions.map((tag) => h('option', { key: tag, value: tag })),
      )

      return h(
        'section',
        {
          className: 'dsh-mb-page',
          'data-drag': dragActive ? 'true' : 'false',
          'data-bulk': state.selectedIds.length > 1 ? 'true' : 'false',
          'aria-label': t('panel'),
          'aria-busy': state.mutating || state.uploading ? 'true' : undefined,
          onDragEnter,
          onDragOver,
          onDragLeave,
          onDrop,
        },
        h('style', null, PAGE_CSS),
        tagSuggestionList,
        h(
          'div',
          { className: 'dsh-mb-visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
          state.statusText,
        ),
        header,
        errorBanner,
        uploads,
        h('div', { className: 'dsh-mb-body' }, h('div', { className: 'dsh-mb-main' }, renderMain()), detailsPanel),
        state.selectedIds.length > 1 ? renderBulkToolbar() : null,
        renderLightbox(),
        helpOpen
          ? h(ShortcutsDialog, { t, onClose: () => setHelpOpen(false), openerRef: helpOpenerRef })
          : null,
        mergeOpen
          ? h(TagMergeDialog, {
              board,
              t,
              openerRef: mergeOpenerRef,
              onClose: closeTagManager,
            })
          : null,
        dragActive
          ? h(
              'div',
              { className: 'dsh-mb-drop-overlay' },
              h('span', { className: 'dsh-mb-drop-overlay-icon', 'aria-hidden': 'true' }, h(IconImage, { size: 26 })),
              t('dropOverlay'),
            )
          : null,
        h('input', {
          ref: fileInputRef,
          type: 'file',
          accept: 'image/*',
          'aria-label': t('addImages'),
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
          'aria-label': t('replace'),
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
              cursor: disabled ? 'default' : 'pointer',
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
        disposed = false
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES))
        const t = ctx.locale.bind(NS)
        activeTranslate = t

        ctx.effect(() => {
          void refresh()
        })

        ctx.effect(() => startBoardSync())

        ctx.effect(() => () => {
          stopBoardSync()
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
