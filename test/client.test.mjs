import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client.js'), 'utf8')

const basePayload = {
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
  const documentListeners = new Map()

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
    return element
  }

  const head = makeElement('head')
  const menubar = makeElement('div')
  if (captionBar) {
    menubar.appendChild(makeElement('button'))
    menubar.appendChild(makeElement('button'))
  }
  const shadowRoot = {
    querySelector: (selector) => (selector === '[role="menubar"]' && captionBar ? menubar : null),
    getElementById: (id) => shadowRoot.children.find((child) => child.id === id) ?? null,
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
    getElementById: (id) => head.children.find((child) => child.id === id) ?? null,
    head,
  }

  return { document, menubar, shadowRoot, head }
}

/** Load the client module against fresh globals and return its registration. */
function loadClient(dom, overrides = {}) {
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
  global.fetch = async () => ({ ok: true, json: async () => ({ ...basePayload, ...overrides }) })

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

const flush = () => new Promise((resolve) => setTimeout(resolve, 30))

/** Run `apply` and return the slot registrations and a cleanup function. */
function mount(ctxSlots, overrides = {}, domOptions = { captionBar: false }) {
  const dom = createDom(domOptions)
  const { mod, timeouts } = loadClient(dom, overrides)
  const injected = []
  let cleanup = null
  const ctx = {
    effect: (fn) => {
      cleanup = fn()
      return () => {}
    },
    slots: {
      inject: (name, factory) => {
        const entry = { name, component: undefined }
        injected.push(entry)
        entry.component = factory()
      },
      register: (descriptor, component) => {
        const entry = injected[injected.length - 1]
        if (entry !== undefined) entry.descriptor = descriptor
        return component
      },
      ...ctxSlots,
    },
  }
  mod.apply(ctx)
  return { dom, injected, timeouts, cleanup: () => cleanup?.(), mod }
}

test('auto position mounts the caption button when the caption menu exists', async () => {
  const { dom, mod } = mount({}, {}, { captionBar: true })
  assert.deepEqual(mod.inject, ['slots'])
  await flush()

  const { menubar, shadowRoot } = dom
  const caption = menubar.children.find((child) => child.className === 'dsh-cb')
  assert.notEqual(caption, undefined, 'caption button is mounted')
  assert.equal(menubar.children.length, 3)
  assert.equal(caption.innerHTML.includes('dsh-cb-balance'), true)
  assert.equal(caption.innerHTML.includes('dsh-cb-phase'), true)
  assert.equal(caption.attributes['aria-label']?.startsWith('余额 ¥59.32'), true)
  assert.equal(shadowRoot.children.some((child) => child.id === 'dsh-caption-balance-caption-style'), true)
})

test('auto position falls back to the header chip without a caption menu', async () => {
  const { injected, timeouts, cleanup } = mount({}, {}, { captionBar: false })
  await flush()
  assert.equal(injected.some((entry) => entry.name === 'conversation.session.header.utilities'), false, 'no header chip before the fallback delay')

  const fallback = timeouts.find((fn) => fn !== null)
  assert.equal(typeof fallback, 'function')
  fallback()

  const headerEntry = injected.find((entry) => entry.name === 'conversation.session.header.utilities')
  assert.notEqual(headerEntry, undefined)
  assert.equal(typeof headerEntry.component, 'function')
  cleanup()
})

test('position: header registers the header chip immediately', async () => {
  const { injected } = mount({}, { display: { position: 'header' } })
  await flush()
  assert.equal(injected.some((entry) => entry.name === 'conversation.session.header.utilities'), true)
})

test('position: sidebar registers the sidebar footer row', async () => {
  const { injected } = mount({}, { display: { position: 'sidebar' } })
  await flush()
  assert.equal(injected.some((entry) => entry.name === 'sidebar.footer.action'), true)
})

test('low balance tints the balance segment with the configured tone', async () => {
  const { dom } = mount(
    {},
    { balance: { status: 'ready', wallets: [{ currency: 'CNY', balance: '5.25' }], bonusWallets: [] }, display: { lowBalanceThreshold: 10 } },
    { captionBar: true },
  )
  await flush()
  const caption = dom.menubar.children.find((child) => child.className === 'dsh-cb')
  assert.equal(caption.innerHTML.includes('dsh-cb-low'), true)
  assert.equal(caption.innerHTML.includes('data-tone="warn"'), true)
})

test('gradient style interpolates the balance colour between the two endpoints', async () => {
  const gradient = (balance) => ({
    balance: { status: 'ready', wallets: [{ currency: 'CNY', balance }], bonusWallets: [] },
    display: {
      lowBalanceStyle: 'gradient',
      gradientFromAmount: 0,
      gradientFromColor: '#000000',
      gradientToAmount: 100,
      gradientToColor: '#ffffff',
    },
  })

  const middle = mount({}, gradient('50.00'), { captionBar: true })
  await flush()
  const caption = middle.dom.menubar.children.find((child) => child.className === 'dsh-cb')
  assert.equal(caption.innerHTML.includes('style="color:#808080"'), true, 'halfway mixes the endpoints')

  const low = mount({}, gradient('10.00'), { captionBar: true })
  await flush()
  const lowCaption = low.dom.menubar.children.find((child) => child.className === 'dsh-cb')
  assert.equal(lowCaption.innerHTML.includes('style="color:#1a1a1a"'), true, 'below the start keeps the start colour')

  const high = mount({}, gradient('120.00'), { captionBar: true })
  await flush()
  const highCaption = high.dom.menubar.children.find((child) => child.className === 'dsh-cb')
  assert.equal(highCaption.innerHTML.includes('style="color:#ffffff"'), true, 'above the end keeps the end colour')
})

test('danger tone is honoured and hidden segments disappear', async () => {
  const { dom } = mount(
    {},
    {
      balance: { status: 'ready', wallets: [{ currency: 'CNY', balance: '1.00' }], bonusWallets: [] },
      display: { lowBalanceStyle: 'danger', showToday: false, showPhase: false },
    },
    { captionBar: true },
  )
  await flush()
  const caption = dom.menubar.children.find((child) => child.className === 'dsh-cb')
  assert.equal(caption.innerHTML.includes('data-tone="danger"'), true)
  assert.equal(caption.innerHTML.includes('dsh-cb-sep'), false)
  assert.equal(caption.innerHTML.includes('dsh-cb-phase'), false)
})
test('registers a settings section independent of the render target', async () => {
  const { dom, injected, cleanup } = mount({}, { display: { position: 'sidebar' } })
  await flush()
  const section = injected.find((entry) => entry.name === 'settings.section')
  assert.notEqual(section, undefined, 'settings page is contributed')
  assert.equal(section.descriptor.id, 'dsh-caption-balance')
  assert.equal(typeof section.descriptor.label, 'function')
  // document.head is an element, not a Document: the old getElementById check
  // threw here and the section was never registered.
  const style = dom.document.head.children.find((child) => child.id === 'dsh-caption-balance-settings-style')
  assert.notEqual(style, undefined, 'settings stylesheet lands in document.head')
  cleanup()
})

test('contributes the display form to the plugins page bundle config', async () => {
  const { injected, cleanup } = mount({}, { display: { position: 'auto' } })
  await flush()
  const entry = injected.find((candidate) => candidate.name === 'plugins.bundle.config')
  assert.notEqual(entry, undefined, 'plugins page bundle config is contributed')
  assert.equal(entry.descriptor.key, 'dsh-caption-balance')
  assert.equal(typeof entry.component, 'function')
  cleanup()
})

test('header and sidebar targets inject their stylesheet into document.head', async () => {
  for (const position of ['header', 'sidebar']) {
    const { dom, cleanup } = mount({}, { display: { position } })
    await flush()
    const style = dom.document.head.children.find((child) => child.id === 'dsh-caption-balance-chip-style')
    assert.notEqual(style, undefined, position + ' stylesheet is injected')
    cleanup()
  }
})