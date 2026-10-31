/**
 * harness-boot.js — load a real client.js build, apply it to the stubbed host
 * and mount the captured `main` slot component.
 *
 * Query parameters (all optional):
 *   client   relative/absolute URL of the client build to load.
 *            Default: ../../client.js (the live working tree).
 *   theme    "light" (default) or "dark"; sets [data-theme] on <html>.
 *   board    "default" or "empty" (read by host-stub.js).
 */
;(function () {
  'use strict'

  const params = new URLSearchParams(window.location.search)
  const clientUrl = params.get('client') || '../../client.js'
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light'

  if (theme === 'dark') {
    document.documentElement.dataset.theme = 'dark'
    document.documentElement.style.colorScheme = 'dark'
  } else {
    document.documentElement.dataset.theme = 'light'
    document.documentElement.style.colorScheme = 'light'
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))

  async function waitFor(check, timeoutMs, label) {
    const deadline = Date.now() + (timeoutMs === undefined ? 8000 : timeoutMs)
    while (Date.now() < deadline) {
      try {
        if (check()) return true
      } catch (error) {
        // Keep polling; a transient query failure is not fatal.
      }
      await sleep(40)
    }
    throw new Error(`harness: timed out waiting for ${label || 'condition'}`)
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = src
      script.async = false
      script.onload = () => resolve()
      script.onerror = () => reject(new Error(`harness: could not load ${src}`))
      document.head.appendChild(script)
    })
  }

  async function settle(extraMs) {
    await waitFor(
      () =>
        document.querySelector('.dsh-mb-page') !== null &&
        (document.querySelector('.dsh-mb-grid') !== null ||
          document.querySelector('.dsh-mb-empty') !== null ||
          document.querySelector('.dsh-mb-banner') !== null ||
          document.querySelector('.dsh-mb-skeleton-grid') !== null),
      8000,
      'the moodboard page',
    )
    await nextFrame()
    await nextFrame()
    // Wait for object-URL thumbnails to decode so screenshots never catch a
    // half-painted gallery.
    const images = Array.prototype.slice.call(document.querySelectorAll('.dsh-mb-page img'))
    await Promise.all(
      images.map((image) =>
        image.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              image.addEventListener('load', resolve, { once: true })
              image.addEventListener('error', resolve, { once: true })
            }),
      ),
    )
    await sleep(extraMs === undefined ? 120 : extraMs)
    await nextFrame()
    return true
  }

  async function boot() {
    const app = document.getElementById('app')
    if (app === null) throw new Error('harness: #app is missing')
    await loadScript(new URL(clientUrl, window.location.href).href)
    const loaded = await window.__MODULE_READY__
    const plugin = loaded.plugin
    if (plugin === null || typeof plugin !== 'object' || typeof plugin.apply !== 'function') {
      throw new Error('harness: client.js did not export { inject, apply }')
    }
    const ctx = window.__HARNESS_CTX__
    plugin.apply(ctx)
    const slots = ctx.__harness.slots
    const main = slots.main
    if (main === undefined || main.component === undefined) {
      throw new Error('harness: client.js did not register the main slot component')
    }
    const React = window.MiniReact
    const view = React.render(
      () => React.createElement(main.component, { key: 'moodboard-main' }),
      app,
    )
    document.documentElement.dataset.harnessReady = 'true'
    window.HARNESS = {
      theme,
      clientUrl: new URL(clientUrl, window.location.href).href,
      plugin,
      slots,
      view,
      errors: window.__HARNESS_ERRORS__,
      settle,
      // Inspect without reaching into the module's private store: render the
      // current page state as plain text for reports and assertions.
      snapshot() {
        const page = document.querySelector('.dsh-mb-page')
        if (page === null) return null
        const cards = document.querySelectorAll('.dsh-mb-card')
        const chips = document.querySelectorAll('.dsh-mb-chip')
        const side = document.querySelector('.dsh-mb-details')
        return {
          cards: cards.length,
          chips: chips.length,
          pinnedBadges: document.querySelectorAll('.dsh-mb-pin-badge').length,
          hero: document.querySelector('.dsh-mb-hero') !== null,
          bulk: document.querySelector('.dsh-mb-bulk') !== null,
          lightbox: document.querySelector('.dsh-mb-lightbox') !== null,
          selectedCards: document.querySelectorAll('.dsh-mb-card[data-selected="true"]').length,
          inspector: side !== null,
          inspectorTitle: side === null ? null : (side.querySelector('.dsh-mb-details-title') || {}).textContent || null,
          dialogs: Array.prototype.map.call(document.querySelectorAll('[role="dialog"]'), (dialog) => ({
            title: (dialog.querySelector('h2') || {}).textContent || null,
            className: dialog.className,
          })),
          empty: document.querySelector('.dsh-mb-empty') !== null,
          loading: document.querySelector('.dsh-mb-skeleton-grid') !== null,
          errors: window.__HARNESS_ERRORS__.map((error) => String(error && error.message ? error.message : error)),
        }
      },
    }
    await settle(150)
    window.HARNESS.ready = true
  }

  boot().catch((error) => {
    window.__HARNESS_ERRORS__.push(error)
    document.documentElement.dataset.harnessError = 'true'
    const app = document.getElementById('app')
    if (app !== null) {
      app.textContent = `Harness failed to boot: ${error && error.message ? error.message : error}`
    }
    if (typeof console !== 'undefined') console.error('[harness]', error)
  })
})()
