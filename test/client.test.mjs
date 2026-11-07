import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client.js'), 'utf8')

const payload = {
  ok: true,
  updatedAt: 1_800_000_000_000,
  window: { phase: 'peak' },
  today: { totalTokens: 4_000_000, cost: 2.5 },
  month: { totalTokens: 40_000_000, cost: 25 },
  balance: { status: 'ready', wallets: [{ currency: 'CNY', balance: '59.3188' }], bonusWallets: [] },
  pricing: { currency: 'CNY' },
}

/** A tiny DOM stub sufficient for the client module. */
function createDom({ captionBar }) {
  const created = []
  const documentListeners = new Map()
  const shadowStyle = { id: '', textContent: '', remove() {} }

  const makeElement = (tag) => {
    const element = {
      tag,
      children: [],
      attributes: {},
      listeners: {},
      innerHTML: '',
      title: '',
      className: '',
      id: '',
      tabIndex: 0,
      parent: null,
      appendChild(child) {
        child.parent = element
        element.children.push(child)
        return child
      },
      addEventListener(name, fn) {
        element.listeners[name] = fn
      },
      setAttribute(name, value) {
        element.attributes[name] = value
      },
      removeAttribute(name) {
        delete element.attributes[name]
      },
      remove() {
        if (element.parent !== null) element.parent.children = element.parent.children.filter((c) => c !== element)
      },
      isConnected: true,
      getElementById(id) {
        return element.children.find((child) => child.id === id) ?? null
      },
      querySelector() {
        return null
      },
    }
    created.push(element)
    return element
  }

  const menubar = makeElement('div')
  if (captionBar) {
    menubar.appendChild(makeElement('button'))
    menubar.appendChild(makeElement('button'))
  }
  const shadowRoot = {
    querySelector: (selector) => (selector === '[role="menubar"]' && captionBar ? menubar : null),
    getElementById: (id) => shadowRoot.children?.find?.((child) => child.id === id) ?? null,
    children: [],
    appendChild(child) {
      child.parent = shadowRoot
      shadowRoot.children.push(child)
      return child
    },
    contains: (child) => shadowRoot.children.includes(child) || menubar.children.includes(child),
  }
  const host = { shadowRoot: captionBar ? shadowRoot : null }

  const document = {
    querySelector: (selector) => (selector === '[data-windows-menu]' && captionBar ? host : null),
    createElement: makeElement,
    addEventListener(name, fn) {
      documentListeners.set(name, fn)
    },
    removeEventListener(name) {
      documentListeners.delete(name)
    },
    visibilityState: 'visible',
    getElementById: (id) => document.head.children.find((child) => child.id === id) ?? null,
    head: makeElement('head'),
  }

  return { document, menubar, shadowRoot, created }
}

/** Load the client module against fresh globals and return its registration. */
function loadClient(dom) {
  const intervals = []
  const timeouts = []
  let loaded = null
  global.window = {
    __ModuleLoader__: {
      load: (spec) => {
        loaded = spec
      },
    },
    setInterval: (fn) => {
      intervals.push(fn)
      return intervals.length
    },
    clearInterval: (id) => {
      intervals[id - 1] = null
    },
    setTimeout: (fn) => {
      timeouts.push(fn)
      return timeouts.length
    },
    clearTimeout: (id) => {
      timeouts[id - 1] = null
    },
  }
  global.document = dom.document
  global.fetch = async () => ({ ok: true, json: async () => payload })

  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (value) => [value, () => {}],
    useEffect: () => {},
  }

  // eslint-disable-next-line no-eval
  eval(source)
  const mod = loaded.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  return { mod, intervals, timeouts }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20))

test('falls back to the conversation header when no caption menu exists', async () => {
  const dom = createDom({ captionBar: false })
  const { mod, timeouts } = loadClient(dom)
  assert.deepEqual(mod.inject, ['slots'])

  let cleanup = null
  const injected = []
  const ctx = {
    effect: (fn) => {
      cleanup = fn()
      return () => {}
    },
    slots: {
      inject: (name, factory) => {
        injected.push({ name, component: factory() })
      },
      register: (descriptor, component) => component,
    },
  }

  mod.apply(ctx)
  await flush()
  assert.equal(injected.length, 0, 'nothing is registered before the fallback delay')

  // Fire the pending 4s fallback timer.
  const fallback = timeouts.find((fn) => fn !== null)
  assert.equal(typeof fallback, 'function')
  fallback()

  assert.equal(injected.length, 1)
  assert.equal(injected[0].name, 'conversation.session.header.utilities')
  assert.equal(typeof injected[0].component, 'function')

  // The chip must get its stylesheet, otherwise it renders as a bare button.
  const style = dom.document.head.children.find((child) => child.id === 'dsh-caption-balance-chip-style')
  assert.notEqual(style, undefined, 'fallback stylesheet is injected')
  assert.equal(style.textContent.includes('.dsh-cb-chip'), true)

  cleanup()
  assert.equal(dom.document.head.children.some((child) => child.id === 'dsh-caption-balance-chip-style'), false)
})

test('appends one button after the caption menu entries when the menu exists', async () => {
  const dom = createDom({ captionBar: true })
  const { menubar, shadowRoot } = dom
  const { mod } = loadClient(dom)

  let cleanup = null
  const ctx = {
    effect: (fn) => {
      cleanup = fn()
      return () => {}
    },
    slots: { inject: () => {}, register: (descriptor, component) => component },
  }

  mod.apply(ctx)
  await flush()

  const caption = menubar.children.find((child) => child.className === 'dsh-cb')
  assert.notEqual(caption, undefined, 'caption button is mounted')
  assert.equal(menubar.children.length, 3)
  assert.equal(caption.attributes['aria-label']?.startsWith('余额 ¥59.32'), true)
  assert.equal(shadowRoot.children.some((child) => child.id === 'dsh-caption-balance-caption-style'), true)

  cleanup()
  assert.equal(menubar.children.includes(caption), false, 'cleanup removes the button')
})
