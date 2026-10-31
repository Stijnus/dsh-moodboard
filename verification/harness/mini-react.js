/**
 * mini-react.js — a deliberately small, deterministic React-compatible shim.
 *
 * It exists only for the Moodboard real-render harness: it executes the real
 * client.js component tree (createElement + hooks) in a browser so the actual
 * plugin UI can be screenshotted. It is NOT a general React replacement.
 *
 * Supported surface:
 *   createElement (className, style objects, event props, key, ref incl.
 *   function refs), Fragment, useState, useReducer, useEffect,
 *   useLayoutEffect, useRef, useMemo, useCallback, useId,
 *   useSyncExternalStore, controlled input/textarea/select values.
 *
 * Rendering model: a tiny keyed virtual-DOM reconciler that reuses DOM nodes
 * across renders so focus, caret position and object URLs survive state
 * updates. State updates are batched into a microtask.
 *
 * Not supported (and not used by client.js): context, portals, Suspense,
 * error boundaries, class components, concurrent features.
 */
;(function () {
  'use strict'

  const SVG_NS = 'http://www.w3.org/2000/svg'
  const TEXT = '#text'
  const FRAGMENT = Symbol('mini.fragment')

  const SVG_TAGS = new Set([
    'svg',
    'g',
    'path',
    'rect',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'text',
    'tspan',
    'defs',
    'use',
    'clipPath',
    'mask',
    'linearGradient',
    'radialGradient',
    'stop',
    'foreignObject',
  ])

  const SVG_ATTRS = {
    viewBox: 'viewBox',
    preserveAspectRatio: 'preserveAspectRatio',
    strokeWidth: 'stroke-width',
    strokeLinecap: 'stroke-linecap',
    strokeLinejoin: 'stroke-linejoin',
    strokeDasharray: 'stroke-dasharray',
    strokeDashoffset: 'stroke-dashoffset',
    strokeMiterlimit: 'stroke-miterlimit',
    fillRule: 'fill-rule',
    clipRule: 'clip-rule',
    clipPath: 'clip-path',
    stopColor: 'stop-color',
    stopOpacity: 'stop-opacity',
    textAnchor: 'text-anchor',
    dominantBaseline: 'dominant-baseline',
    vectorEffect: 'vector-effect',
    xmlnsXlink: 'xmlns:xlink',
  }

  const ATTR_ALIASES = {
    className: 'class',
    htmlFor: 'for',
    tabIndex: 'tabindex',
    autoComplete: 'autocomplete',
    autoCapitalize: 'autocapitalize',
    autoCorrect: 'autocorrect',
    spellCheck: 'spellcheck',
    readOnly: 'readonly',
    maxLength: 'maxlength',
    minLength: 'minlength',
    contentEditable: 'contenteditable',
    inputMode: 'inputmode',
    enterKeyHint: 'enterkeyhint',
    acceptCharset: 'accept-charset',
    httpEquiv: 'http-equiv',
    referrerPolicy: 'referrerpolicy',
    crossOrigin: 'crossorigin',
    srcSet: 'srcset',
    useMap: 'usemap',
  }

  const UNITLESS = new Set([
    'animationIterationCount',
    'aspectRatio',
    'borderImageOutset',
    'borderImageSlice',
    'borderImageWidth',
    'boxFlex',
    'boxFlexGroup',
    'boxOrdinalGroup',
    'columnCount',
    'columns',
    'flex',
    'flexGrow',
    'flexPositive',
    'flexShrink',
    'flexNegative',
    'flexOrder',
    'gridArea',
    'gridRow',
    'gridRowEnd',
    'gridRowSpan',
    'gridRowStart',
    'gridColumn',
    'gridColumnEnd',
    'gridColumnSpan',
    'gridColumnStart',
    'fontWeight',
    'lineClamp',
    'lineHeight',
    'opacity',
    'order',
    'orphans',
    'scale',
    'tabSize',
    'widows',
    'zIndex',
    'zoom',
    'fillOpacity',
    'floodOpacity',
    'stopOpacity',
    'strokeDasharray',
    'strokeDashoffset',
    'strokeMiterlimit',
    'strokeOpacity',
    'strokeWidth',
  ])

  // ---------------------------------------------------------------------------
  // VNodes
  // ---------------------------------------------------------------------------

  function isVNode(value) {
    return value !== null && typeof value === 'object' && value.__mini === true
  }

  function isFragment(value) {
    return isVNode(value) && value.type === FRAGMENT
  }

  function textVNode(value) {
    return { __mini: true, type: TEXT, key: null, value: String(value), props: null, children: null }
  }

  function appendChildVNodes(out, child) {
    if (child === null || child === undefined || typeof child === 'boolean') return
    if (Array.isArray(child)) {
      for (const entry of child) appendChildVNodes(out, entry)
      return
    }
    if (isFragment(child)) {
      for (const entry of child.children) appendChildVNodes(out, entry)
      return
    }
    if (isVNode(child)) {
      out.push(child)
      return
    }
    if (typeof child === 'string' || typeof child === 'number') {
      out.push(textVNode(child))
      return
    }
    // Anything else (a function, a random object) is dropped like React does.
  }

  function childKey(vnode, index) {
    return vnode.key === null || vnode.key === undefined ? `i:${index}` : `k:${String(vnode.key)}`
  }

  function createElement(type, config) {
    const props = {}
    let key = null
    if (config !== null && config !== undefined && typeof config === 'object') {
      for (const name of Object.keys(config)) {
        if (name === 'key') {
          if (config[name] !== undefined) key = config[name]
        } else {
          props[name] = config[name]
        }
      }
    }
    const children = []
    for (let index = 2; index < arguments.length; index += 1) {
      appendChildVNodes(children, arguments[index])
    }
    props.children = children
    return { __mini: true, type, key, props, children }
  }

  function normalizeOutput(output) {
    if (output === null || output === undefined || typeof output === 'boolean') return null
    if (Array.isArray(output) || isFragment(output)) {
      const flat = []
      appendChildVNodes(flat, output)
      if (flat.length === 0) return null
      if (flat.length === 1) return flat[0]
      // Multi-root component/fragment output: a layout-transparent wrapper keeps
      // the DOM well-formed without changing the visual box.
      return {
        __mini: true,
        type: 'span',
        key: null,
        props: { style: { display: 'contents' }, 'data-mini-fragment': 'true' },
        children: flat,
      }
    }
    if (isVNode(output)) return output
    if (typeof output === 'string' || typeof output === 'number') return textVNode(output)
    return null
  }

  // ---------------------------------------------------------------------------
  // Hook dispatch
  // ---------------------------------------------------------------------------

  let currentInstance = null
  let currentIndex = 0

  function hookSlot(kind) {
    if (currentInstance === null) throw new Error('mini-react: hooks may only be called inside a component')
    const index = currentIndex
    currentIndex += 1
    let hook = currentInstance.hooks[index]
    if (hook === undefined) {
      hook = { kind, mounted: true }
      currentInstance.hooks[index] = hook
    }
    return hook
  }

  function depsChanged(hook, deps) {
    if (deps === undefined || deps === null) return true
    if (!Array.isArray(hook.deps)) return true
    if (hook.deps.length !== deps.length) return true
    for (let index = 0; index < deps.length; index += 1) {
      if (!Object.is(hook.deps[index], deps[index])) return true
    }
    return false
  }

  function useState(initial) {
    const hook = hookSlot('state')
    if (hook.initialized !== true) {
      hook.initialized = true
      hook.state = typeof initial === 'function' ? initial() : initial
    }
    const instance = currentInstance
    if (hook.setter === undefined) {
      hook.setter = (action) => {
        if (instance.unmounted) return
        const next = typeof action === 'function' ? action(hook.state) : action
        if (Object.is(next, hook.state)) return
        hook.state = next
        scheduleRender(instance.root)
      }
    }
    return [hook.state, hook.setter]
  }

  function useReducer(reducer, initialArg, init) {
    const hook = hookSlot('reducer')
    if (hook.initialized !== true) {
      hook.initialized = true
      hook.state = init === undefined ? initialArg : init(initialArg)
    }
    const instance = currentInstance
    if (hook.dispatch === undefined) {
      hook.dispatch = (action) => {
        if (instance.unmounted) return
        hook.state = reducer(hook.state, action)
        scheduleRender(instance.root)
      }
    }
    return [hook.state, hook.dispatch]
  }

  function useEffectImpl(fn, deps, layout) {
    const hook = hookSlot(layout ? 'layoutEffect' : 'effect')
    hook.fn = fn
    if (depsChanged(hook, deps)) {
      hook.pendingRun = true
      if (currentInstance.root !== null) currentInstance.root.pendingEffects.push({ instance: currentInstance, hook })
    }
    hook.deps = deps === undefined || deps === null ? undefined : Array.prototype.slice.call(deps)
  }

  function useEffect(fn, deps) {
    useEffectImpl(fn, deps, false)
  }

  function useLayoutEffect(fn, deps) {
    useEffectImpl(fn, deps, true)
  }

  function useRef(initial) {
    const hook = hookSlot('ref')
    if (hook.initialized !== true) {
      hook.initialized = true
      hook.ref = { current: initial === undefined ? null : initial }
    }
    return hook.ref
  }

  function useMemo(compute, deps) {
    const hook = hookSlot('memo')
    if (depsChanged(hook, deps)) {
      hook.value = compute()
      hook.deps = deps === undefined || deps === null ? undefined : Array.prototype.slice.call(deps)
    }
    return hook.value
  }

  function useCallback(fn, deps) {
    return useMemo(() => fn, deps)
  }

  let idSequence = 0
  function useId() {
    const hook = hookSlot('id')
    if (hook.initialized !== true) {
      hook.initialized = true
      idSequence += 1
      hook.id = `mini-${idSequence}`
    }
    return hook.id
  }

  function useSyncExternalStore(subscribe, getSnapshot) {
    const hook = hookSlot('store')
    const instance = currentInstance
    hook.subscribe = subscribe
    hook.getSnapshot = getSnapshot
    if (instance.root !== null) instance.root.pendingStores.push({ instance, hook })
    return getSnapshot()
  }

  const Hooks = {
    useState,
    useReducer,
    useEffect,
    useLayoutEffect,
    useRef,
    useMemo,
    useCallback,
    useId,
    useSyncExternalStore,
  }

  // ---------------------------------------------------------------------------
  // Scheduling
  // ---------------------------------------------------------------------------

  const roots = new Set()
  let renderScheduled = false

  function scheduleRender(root) {
    if (root !== null && root !== undefined) root.dirty = true
    else for (const entry of roots) entry.dirty = true
    if (renderScheduled) return
    renderScheduled = true
    Promise.resolve().then(() => {
      renderScheduled = false
      for (const entry of Array.from(roots)) {
        if (entry.dirty) flushRoot(entry)
      }
    })
  }

  // ---------------------------------------------------------------------------
  // DOM props
  // ---------------------------------------------------------------------------

  function isEventProp(name, value) {
    if (typeof value !== 'function') return false
    if (name.length < 3) return false
    if (name[0] !== 'o' || name[1] !== 'n') return false
    const third = name[2]
    return third >= 'A' && third <= 'Z'
  }

  function eventName(propName, tagName) {
    const raw = propName.slice(2)
    if (raw === 'DoubleClick') return 'dblclick'
    if (raw === 'Change') {
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return 'input'
      return 'change'
    }
    return raw.toLowerCase()
  }

  function setStyle(el, oldStyle, newStyle) {
    const previous = oldStyle !== null && typeof oldStyle === 'object' ? oldStyle : {}
    const next = newStyle !== null && typeof newStyle === 'object' ? newStyle : {}
    for (const name of Object.keys(previous)) {
      if (!(name in next)) {
        if (name.indexOf('--') === 0) el.style.removeProperty(name)
        else el.style[cssName(name)] = ''
      }
    }
    for (const name of Object.keys(next)) {
      const value = next[name]
      if (value === null || value === undefined || value === false) {
        if (name.indexOf('--') === 0) el.style.removeProperty(name)
        else el.style[cssName(name)] = ''
        continue
      }
      if (name.indexOf('--') === 0) {
        el.style.setProperty(name, String(value))
        continue
      }
      const tail = typeof value === 'number' && value !== 0 && !UNITLESS.has(name) ? `${value}px` : String(value)
      el.style[cssName(name)] = tail
    }
  }

  function cssName(name) {
    if (name.indexOf('--') === 0) return name
    if (name.indexOf('-') !== -1) return name
    return name.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
  }

  function setAttributeValue(el, name, value, isSvg) {
    if (value === null || value === undefined || value === false) {
      el.removeAttribute(name)
      return
    }
    if (value === true) {
      el.setAttribute(name, '')
      return
    }
    el.setAttribute(name, String(value))
  }

  function setValueProperty(el, value) {
    const next = value === null || value === undefined ? '' : Array.isArray(value) ? value.join(' ') : String(value)
    if (el.value !== next) el.value = next
  }

  function applyProp(el, name, value, oldValue) {
    const tagName = el.tagName === undefined ? '' : el.tagName.toLowerCase()
    const isSvg = el.namespaceURI === SVG_NS
    if (name === 'children' || name === 'key' || name === 'ref' || name === 'dangerouslySetInnerHTML') return
    if (name === 'style') {
      setStyle(el, oldValue, value)
      return
    }
    if (name === 'className') {
      if (value === null || value === undefined || value === '') el.removeAttribute('class')
      else el.setAttribute('class', String(value))
      return
    }
    if (name === 'htmlFor') {
      setAttributeValue(el, 'for', value, isSvg)
      return
    }
    if (name === 'value') {
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
        setValueProperty(el, value)
      } else {
        setAttributeValue(el, 'value', value, isSvg)
      }
      return
    }
    if (name === 'checked') {
      el.checked = value === true
      return
    }
    if (name === 'autoFocus' || name === 'autoFocused') return
    if (name === 'defaultValue' || name === 'defaultChecked') return
    if (isEventProp(name, value) || isEventProp(name, oldValue)) return
    let attrName = name
    if (isSvg) attrName = SVG_ATTRS[name] || name
    else attrName = ATTR_ALIASES[name] || name
    setAttributeValue(el, attrName, value, isSvg)
  }

  function setProps(el, oldProps, newProps) {
    const previous = oldProps !== null && typeof oldProps === 'object' ? oldProps : {}
    const next = newProps !== null && typeof newProps === 'object' ? newProps : {}
    const names = new Set([...Object.keys(previous), ...Object.keys(next)])
    for (const name of names) {
      const oldValue = previous[name]
      const newValue = next[name]
      if (oldValue === newValue) continue
      if (isEventProp(name, oldValue) || isEventProp(name, newValue)) {
        const type = eventName(name, el.tagName === undefined ? '' : el.tagName.toLowerCase())
        const store = el.__miniHandlers || (el.__miniHandlers = {})
        if (store[type] !== undefined) {
          el.removeEventListener(type, store[type])
          delete store[type]
        }
        if (typeof newValue === 'function') {
          store[type] = newValue
          el.addEventListener(type, newValue)
        }
        continue
      }
      if (name === 'ref') continue
      applyProp(el, name, newValue, oldValue)
    }
    if (next.autoFocus === true) pendingAutofocus.push(el)
  }

  // ---------------------------------------------------------------------------
  // Mount / patch / unmount
  // ---------------------------------------------------------------------------

  const pendingAutofocus = []

  function createDom(vnode) {
    if (vnode.type === TEXT) return document.createTextNode(vnode.value)
    const tag = vnode.type
    const isSvg = SVG_TAGS.has(tag) || vnode.__svg === true
    return isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag)
  }

  function mountChildren(parent, children, svgContext) {
    for (const child of children) mountVNode(parent, child, svgContext)
  }

  function mountVNode(parent, vnode, svgContext) {
    if (vnode === null || vnode === undefined) return null
    if (vnode.type === TEXT) {
      const dom = document.createTextNode(vnode.value)
      vnode.dom = dom
      parent.appendChild(dom)
      return dom
    }
    if (typeof vnode.type === 'function') return mountComponent(parent, vnode, svgContext)
    const svg = svgContext === true || SVG_TAGS.has(vnode.type)
    const dom = svg ? document.createElementNS(SVG_NS, vnode.type) : document.createElement(vnode.type)
    vnode.dom = dom
    vnode.__svg = svg
    setProps(dom, {}, vnode.props)
    parent.appendChild(dom)
    mountChildren(dom, vnode.children, svg)
    attachRef(vnode, dom)
    return dom
  }

  function mountComponent(parent, vnode, svgContext) {
    const instance = {
      hooks: [],
      props: vnode.props,
      fn: vnode.type,
      root: currentRoot,
      unmounted: false,
    }
    vnode.instance = instance
    const output = normalizeOutput(renderComponent(instance))
    vnode.childVNode = output
    let dom = null
    if (output !== null) dom = mountVNode(parent, output, svgContext)
    vnode.dom = dom
    return dom
  }

  function patchChild(parent, oldVNode, newVNode, svgContext) {
    if (newVNode === null || newVNode === undefined) {
      if (oldVNode !== null && oldVNode !== undefined) removeVNode(oldVNode)
      return null
    }
    if (oldVNode === null || oldVNode === undefined || oldVNode.type !== newVNode.type || !sameKey(oldVNode, newVNode)) {
      if (oldVNode !== null && oldVNode !== undefined) removeVNode(oldVNode)
      return mountVNode(parent, newVNode, svgContext)
    }
    if (newVNode.type === TEXT) {
      newVNode.dom = oldVNode.dom
      if (oldVNode.value !== newVNode.value) newVNode.dom.nodeValue = newVNode.value
      return newVNode.dom
    }
    if (typeof newVNode.type === 'function') {
      const instance = oldVNode.instance
      instance.props = newVNode.props
      newVNode.instance = instance
      instance.unmounted = false
      const output = normalizeOutput(renderComponent(instance))
      const previousChild = oldVNode.childVNode
      let dom = null
      if (previousChild === null || previousChild === undefined) {
        dom = output === null ? null : mountVNode(parent, output, svgContext)
      } else if (output === null) {
        removeVNode(previousChild)
        dom = null
      } else {
        dom = patchChild(parent, previousChild, output, svgContext)
      }
      newVNode.childVNode = output
      newVNode.dom = dom
      return dom
    }
    // Element
    const dom = oldVNode.dom
    newVNode.dom = dom
    newVNode.__svg = oldVNode.__svg
    setProps(dom, oldVNode.props, newVNode.props)
    if (oldVNode.props.ref !== newVNode.props.ref) {
      attachRef(newVNode, dom)
    }
    patchChildren(dom, oldVNode.children, newVNode.children, svgContext === true || SVG_TAGS.has(newVNode.type))
    return dom
  }

  function sameKey(left, right) {
    return left.key === right.key || (left.key === null && right.key === undefined) || (left.key === undefined && right.key === null)
  }

  function patchChildren(parent, oldChildren, newChildren, svgContext) {
    const oldKeyed = new Map()
    for (const child of oldChildren) {
      if (child.key !== null && child.key !== undefined) oldKeyed.set(`k:${String(child.key)}`, child)
    }
    const used = new Set()
    const results = []
    for (let index = 0; index < newChildren.length; index += 1) {
      const child = newChildren[index]
      let oldChild = null
      if (child.key !== null && child.key !== undefined) {
        const candidate = oldKeyed.get(`k:${String(child.key)}`)
        if (candidate !== undefined && !used.has(candidate)) {
          oldChild = candidate
          used.add(candidate)
        }
      }
      if (oldChild === null) {
        const positional = oldChildren[index]
        if (positional !== undefined && !used.has(positional) && sameKey(positional, child)) {
          oldChild = positional
          used.add(positional)
        }
      }
      if (oldChild === null) {
        for (const candidate of oldChildren) {
          if (used.has(candidate)) continue
          if (sameKey(candidate, child) && candidate.type === child.type) {
            oldChild = candidate
            used.add(candidate)
            break
          }
        }
      }
      const dom = patchChild(parent, oldChild, child, svgContext)
      results.push(dom)
    }
    for (const child of oldChildren) {
      if (!used.has(child)) removeVNode(child)
    }
    // Keep the DOM order in sync without touching nodes that are already in
    // place (moving a focused node can blur it).
    let cursor = parent.firstChild
    for (const dom of results) {
      if (dom === null || dom === undefined) continue
      if (dom === cursor) {
        cursor = dom.nextSibling
        continue
      }
      parent.insertBefore(dom, cursor)
      cursor = dom.nextSibling
    }
  }

  function attachRef(vnode, dom) {
    const ref = vnode.props === null || vnode.props === undefined ? null : vnode.props.ref
    if (ref === null || ref === undefined) return
    if (typeof ref === 'function') ref(dom)
    else ref.current = dom
  }

  function detachRef(vnode) {
    const ref = vnode.props === null || vnode.props === undefined ? null : vnode.props.ref
    if (ref === null || ref === undefined) return
    if (typeof ref === 'function') ref(null)
    else ref.current = null
  }

  function removeVNode(vnode) {
    if (vnode === null || vnode === undefined) return
    if (vnode.type === TEXT) {
      if (vnode.dom !== null && vnode.dom !== undefined && vnode.dom.parentNode !== null) vnode.dom.parentNode.removeChild(vnode.dom)
      return
    }
    if (typeof vnode.type === 'function') {
      cleanupInstance(vnode.instance)
      if (vnode.childVNode !== null && vnode.childVNode !== undefined) removeVNode(vnode.childVNode)
      return
    }
    detachRef(vnode)
    for (const child of vnode.children) removeVNode(child)
    if (vnode.dom !== null && vnode.dom !== undefined && vnode.dom.parentNode !== null) vnode.dom.parentNode.removeChild(vnode.dom)
  }

  function cleanupInstance(instance) {
    if (instance === null || instance === undefined || instance.unmounted === true) return
    instance.unmounted = true
    for (const hook of instance.hooks) {
      if (hook.kind === 'effect' || hook.kind === 'layoutEffect') {
        if (typeof hook.cleanup === 'function') {
          const cleanup = hook.cleanup
          hook.cleanup = undefined
          try {
            cleanup()
          } catch (error) {
            reportError(error)
          }
        }
      }
      if (hook.kind === 'store' && typeof hook.unsubscribe === 'function') {
        try {
          hook.unsubscribe()
        } catch (error) {
          reportError(error)
        }
        hook.unsubscribe = undefined
      }
    }
  }

  function renderComponent(instance) {
    const previousInstance = currentInstance
    const previousIndex = currentIndex
    currentInstance = instance
    currentIndex = 0
    try {
      return instance.fn(instance.props)
    } finally {
      currentInstance = previousInstance
      currentIndex = previousIndex
    }
  }

  // ---------------------------------------------------------------------------
  // Roots
  // ---------------------------------------------------------------------------

  let currentRoot = null

  function flushRoot(root) {
    if (root.renderFn === null) return
    root.dirty = false
    root.pendingEffects = []
    root.pendingStores = []
    const previousRoot = currentRoot
    currentRoot = root
    try {
      const previousVNode = root.current
      const nextVNode = normalizeOutput(root.renderFn())
      if (previousVNode === null || previousVNode === undefined) {
        root.current = nextVNode
        if (nextVNode !== null) mountVNode(root.container, nextVNode, false)
      } else if (nextVNode === null) {
        removeVNode(previousVNode)
        root.current = null
      } else {
        patchChild(root.container, previousVNode, nextVNode, false)
        root.current = nextVNode
      }
      runCommit(root)
    } finally {
      currentRoot = previousRoot
    }
    if (pendingAutofocus.length > 0) {
      const nodes = pendingAutofocus.splice(0, pendingAutofocus.length)
      for (const node of nodes) {
        if (node !== null && node.isConnected === true) {
          try {
            node.focus()
          } catch (error) {
            // Failing to focus is harmless in the harness.
          }
        }
      }
    }
  }

  function runCommit(root) {
    const effects = root.pendingEffects
    const stores = root.pendingStores
    root.pendingEffects = []
    root.pendingStores = []
    // Cleanups run before the new effects, like React.
    for (const entry of effects) {
      const hook = entry.hook
      if (hook.pendingRun !== true) continue
      if (typeof hook.cleanup === 'function') {
        const cleanup = hook.cleanup
        hook.cleanup = undefined
        try {
          cleanup()
        } catch (error) {
          reportError(error)
        }
      }
    }
    for (const entry of effects) {
      const hook = entry.hook
      if (hook.pendingRun !== true) continue
      hook.pendingRun = false
      if (entry.instance.unmounted === true) continue
      try {
        const result = hook.fn()
        hook.cleanup = typeof result === 'function' ? result : undefined
      } catch (error) {
        reportError(error)
      }
    }
    for (const entry of stores) {
      const hook = entry.hook
      const instance = entry.instance
      if (instance.unmounted === true) continue
      const changed = hook.prevSubscribe !== hook.subscribe
      if (changed && typeof hook.unsubscribe === 'function') {
        try {
          hook.unsubscribe()
        } catch (error) {
          reportError(error)
        }
        hook.unsubscribe = undefined
      }
      if (typeof hook.unsubscribe !== 'function') {
        hook.prevSubscribe = hook.subscribe
        try {
          hook.unsubscribe = hook.subscribe(() => {
            if (instance.unmounted !== true) scheduleRender(instance.root)
          })
        } catch (error) {
          reportError(error)
        }
      }
    }
  }

  function createRoot(container) {
    const root = {
      container,
      current: null,
      renderFn: null,
      dirty: false,
      pendingEffects: [],
      pendingStores: [],
    }
    roots.add(root)
    return root
  }

  function render(renderFn, container) {
    if (typeof renderFn !== 'function') throw new Error('mini-react: render() expects a render function')
    let root = container.__miniRoot
    if (root === undefined) {
      root = createRoot(container)
      container.__miniRoot = root
    }
    root.renderFn = renderFn
    const previousRoot = currentRoot
    currentRoot = root
    try {
      root.pendingEffects = []
      root.pendingStores = []
      const nextVNode = normalizeOutput(renderFn())
      if (root.current === null) {
        root.current = nextVNode
        if (nextVNode !== null) mountVNode(container, nextVNode, false)
      } else if (nextVNode === null) {
        removeVNode(root.current)
        root.current = null
      } else {
        patchChild(container, root.current, nextVNode, false)
        root.current = nextVNode
      }
      runCommit(root)
    } finally {
      currentRoot = previousRoot
    }
    return {
      rerender() {
        scheduleRender(root)
      },
      unmount() {
        if (root.current !== null) removeVNode(root.current)
        root.current = null
        root.renderFn = null
        roots.delete(root)
      },
      root,
    }
  }

  function reportError(error) {
    if (window.__HARNESS_ERRORS__ !== undefined) window.__HARNESS_ERRORS__.push(error)
    // Keep the error visible in the console like a React render error would be.
    if (typeof console !== 'undefined' && console.error !== undefined) console.error('[mini-react]', error)
  }

  window.MiniReact = {
    createElement,
    cloneElement(element, config) {
      const props = Object.assign({}, element.props, config)
      return createElement(element.type, props, props.children)
    },
    Fragment: FRAGMENT,
    useState,
    useReducer,
    useEffect,
    useLayoutEffect,
    useInsertionEffect: useLayoutEffect,
    useRef,
    useMemo,
    useCallback,
    useId,
    useSyncExternalStore,
    createRoot(container) {
      return {
        render(renderFn) {
          return render(renderFn, container)
        },
      }
    },
    render,
    h: createElement,
    version: '0.0.1-mini',
  }
})()
