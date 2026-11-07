/**
 * Client half of dsh-caption-balance.
 *
 * Two render targets, one data source:
 *
 * 1. Windows desktop — DSH's caption menu is injected by the desktop preload as
 *    a `[data-windows-menu]` host with an open shadow root holding a
 *    `[role=menubar]`. One more button is appended there, right after 编辑, and
 *    inherits the caption's own button styling.
 * 2. Anything without that menu (macOS desktop, `dsh web`) — the widget falls
 *    back to the conversation header's utilities slot, which is where the
 *    session title bar keeps its inline chips.
 *
 * Both read the same host route and share one poller.
 */
window.__ModuleLoader__.load({
  id: 'dsh-caption-balance',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const ROUTE = '/api/dsh-caption-balance/summary'
    const MENU_HOST = '[data-windows-menu]'
    const MENUBAR = '[role="menubar"]'
    const CAPTION_STYLE_ID = 'dsh-caption-balance-caption-style'
    const FALLBACK_SLOT = 'conversation.session.header.utilities'
    const MOUNT_INTERVAL_MS = 500
    const FALLBACK_DELAY_MS = 4_000
    const REFRESH_MS = 30_000

    const captionCss = `
button.dsh-cb {
  display: inline-flex; align-items: baseline;
  height: 28px; line-height: 28px;
  font-variant-numeric: tabular-nums;
}
button.dsh-cb .dsh-cb-dec { font-size: 0.82em; opacity: 0.8; }
button.dsh-cb .dsh-cb-sep { margin: 0 4px; opacity: 0.45; }
button.dsh-cb .dsh-cb-phase { margin-left: 6px; font-size: 12px; line-height: inherit; color: var(--dsw-alias-label-tertiary); }
button.dsh-cb .dsh-cb-phase[data-peak='true'] { color: var(--dsw-alias-state-warn-label, #d9a441); }
`

    const fallbackCss = `
.dsh-cb-chip {
  display: inline-flex; align-items: baseline; flex: none;
  height: 28px; box-sizing: border-box; padding: 0 8px;
  margin: 0; border: 0; border-radius: var(--dsw-radius-md, 8px);
  background: transparent; color: var(--dsw-alias-label-tertiary, inherit);
  font-family: inherit; font-size: 13px; line-height: 28px;
  white-space: nowrap; cursor: pointer; font-variant-numeric: tabular-nums;
}
.dsh-cb-chip:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14)); }
.dsh-cb-chip:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe); outline-offset: -2px; }
.dsh-cb-chip .dsh-cb-dec { font-size: 0.82em; opacity: 0.8; }
.dsh-cb-chip .dsh-cb-sep { margin: 0 4px; opacity: 0.45; }
.dsh-cb-chip .dsh-cb-phase { margin-left: 6px; font-size: 12px; color: var(--dsw-alias-label-tertiary, inherit); }
.dsh-cb-chip .dsh-cb-phase[data-peak='true'] { color: var(--dsw-alias-state-warn-label, #d9a441); }
`

    const currencySymbol = (currency) => (currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : '')

    /** Format one amount, returning its integer and decimal halves separately. */
    function splitMoney(currency, value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return null
      const absolute = Math.abs(number)
      // Money keeps a fixed number of decimals so the caption never jitters
      // between `¥59.6` and `¥59.60` as the value changes.
      const decimals = absolute < 0.01 ? 4 : absolute < 1 ? 3 : 2
      const text = number.toFixed(decimals)
      const dot = text.indexOf('.')
      return dot < 0
        ? { symbol: currencySymbol(currency), integer: text, decimal: '' }
        : { symbol: currencySymbol(currency), integer: text.slice(0, dot), decimal: text.slice(dot) }
    }

    /** `¥62.69` with the decimals one step smaller, as HTML markup. */
    function amountMarkup(currency, value) {
      const parts = splitMoney(currency, value)
      if (parts === null) return '—'
      if (parts.decimal.length === 0) return `${parts.symbol}${parts.integer}`
      return `${parts.symbol}${parts.integer}<span class="dsh-cb-dec">${parts.decimal}</span>`
    }

    /** The same amount as React nodes, for the header chip. */
    function amountNodes(currency, value, key) {
      const parts = splitMoney(currency, value)
      if (parts === null) return h('span', { key }, '—')
      if (parts.decimal.length === 0) return h('span', { key }, `${parts.symbol}${parts.integer}`)
      return h(
        'span',
        { key },
        h('span', { key: 'i' }, `${parts.symbol}${parts.integer}`),
        h('span', { className: 'dsh-cb-dec', key: 'd' }, parts.decimal),
      )
    }

    /** Plain-text variant for tooltips and aria labels. */
    function amountText(currency, value) {
      const parts = splitMoney(currency, value)
      return parts === null ? '—' : `${parts.symbol}${parts.integer}${parts.decimal}`
    }

    function tokenText(value) {
      const number = Number(value)
      if (!Number.isFinite(number) || number <= 0) return '0'
      if (number < 1e3) return String(Math.round(number))
      if (number < 1e6) return `${(number / 1e3).toFixed(1).replace(/\.0$/, '')}K`
      if (number < 1e9) return `${(number / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`
      return `${(number / 1e9).toFixed(2).replace(/\.?0+$/, '')}B`
    }

    function clockText(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return '—'
      const date = new Date(ms)
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    }

    function walletSummary(balance, currency) {
      if (balance === null || balance === undefined) return '…'
      if (balance.status !== 'ready') {
        if (balance.status === 'signed-out') return '未登录'
        if (balance.status === 'unavailable') return '账号服务不可用'
        return '查询失败'
      }
      const wallets = Array.isArray(balance.wallets) ? balance.wallets : []
      if (wallets.length === 0) return '—'
      return wallets.map((wallet) => amountText(wallet.currency ?? currency, wallet.balance)).join(' / ')
    }

    function walletMarkup(balance, currency) {
      if (balance === null || balance === undefined) return '…'
      if (balance.status !== 'ready') return walletSummary(balance, currency)
      const wallets = Array.isArray(balance.wallets) ? balance.wallets : []
      if (wallets.length === 0) return '—'
      return wallets
        .map((wallet, index) => `${index > 0 ? ' / ' : ''}${amountMarkup(wallet.currency ?? currency, wallet.balance)}`)
        .join('')
    }

    function walletNodes(balance, currency) {
      if (balance === null || balance === undefined) return [h('span', { key: 'x' }, '…')]
      if (balance.status !== 'ready') return [h('span', { key: 'x' }, walletSummary(balance, currency))]
      const wallets = Array.isArray(balance.wallets) ? balance.wallets : []
      if (wallets.length === 0) return [h('span', { key: 'x' }, '—')]
      const nodes = []
      wallets.forEach((wallet, index) => {
        if (index > 0) nodes.push(h('span', { key: `sep-${index}` }, ' / '))
        nodes.push(amountNodes(wallet.currency ?? currency, wallet.balance, `w-${index}`))
      })
      return nodes
    }

    function bonusText(balance, currency) {
      const wallets = balance !== null && balance !== undefined && balance.status === 'ready'
        && Array.isArray(balance.bonusWallets) ? balance.bonusWallets : []
      const positive = wallets.filter((wallet) => Number(wallet.balance) > 0)
      if (positive.length === 0) return ''
      return positive.map((wallet) => amountText(wallet.currency ?? currency, wallet.balance)).join(' / ')
    }

    /** Multi-line native tooltip describing every number behind the button. */
    function tooltip(data, error) {
      if (error !== null) return ['余额读取失败', error, '点击重试'].join('\n')
      if (data === null) return '正在读取余额与用量…'
      const currency = data?.pricing?.currency ?? 'CNY'
      const rows = [`余额：${walletSummary(data.balance, currency)}`]
      const bonus = bonusText(data.balance, currency)
      if (bonus.length > 0) rows.push(`赠送：${bonus}`)
      if (data.today) {
        rows.push(`今日：${tokenText(data.today.totalTokens)} tokens · ${amountText(currency, data.today.cost)}`)
      }
      if (data.month) {
        rows.push(`本月：${tokenText(data.month.totalTokens)} tokens · ${amountText(currency, data.month.cost)}`)
      }
      if (data.window) {
        rows.push(`当前：${data.window.phase === 'peak' ? '高峰时段 ×2' : '空闲时段（半价）'}`)
      }
      rows.push(`更新 ${clockText(data.updatedAt)} · 点击刷新`)
      return rows.join('\n')
    }

    function ariaLabel(data, error) {
      if (error !== null) return '余额读取失败'
      const currency = data?.pricing?.currency ?? 'CNY'
      return `余额 ${walletSummary(data?.balance, currency)}，今日花费 ${data?.today ? amountText(currency, data.today.cost) : '…'}`
    }

    /** Fill one caption button (DOM) with the latest state. */
    function paintCaption(button, data, error) {
      if (button === null) return
      const currency = data?.pricing?.currency ?? 'CNY'
      const loading = data === null && error === null
      const balance = error !== null && data === null ? '—' : loading ? '…' : walletMarkup(data.balance, currency)
      const cost = error !== null && data === null ? '—' : loading ? '…' : amountMarkup(currency, data?.today?.cost)
      const phase = data?.window?.phase ?? null

      button.innerHTML =
        `<span class="dsh-cb-amount">${balance}</span>` +
        `<span class="dsh-cb-sep">·</span>` +
        `<span class="dsh-cb-amount">${cost}</span>` +
        (phase === null
          ? ''
          : `<span class="dsh-cb-phase" data-peak="${phase === 'peak'}">${phase === 'peak' ? '峰' : '谷'}</span>`)
      button.title = tooltip(data, error)
      button.setAttribute('aria-label', ariaLabel(data, error))
    }

    /** Shared poller: one request loop, any number of render targets. */
    function createPoller() {
      let state = { data: null, error: null }
      const listeners = new Set()

      const emit = () => {
        for (const listener of listeners) {
          try {
            listener(state)
          } catch {
            // One broken subscriber must not stop the others.
          }
        }
      }

      const refresh = async (force) => {
        try {
          const response = await fetch(`${ROUTE}${force === true ? '?force=1' : ''}`, {
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = await response.json()
          if (payload?.ok !== true) throw new Error(payload?.error ?? 'bad payload')
          state = { data: payload, error: null }
        } catch (cause) {
          state = { data: state.data, error: String(cause?.message ?? cause) }
        }
        emit()
      }

      const subscribe = (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }

      return { refresh, subscribe, get: () => state }
    }

    /** Find the caption menubar inside the preload's open shadow root. */
    function findMenubar() {
      const host = document.querySelector(MENU_HOST)
      if (host === null || host.shadowRoot === null) return null
      const bar = host.shadowRoot.querySelector(MENUBAR)
      return bar === null ? null : { root: host.shadowRoot, bar }
    }

    function ensureCaptionStyle(root) {
      if (root.getElementById(CAPTION_STYLE_ID) !== null) return
      const style = document.createElement('style')
      style.id = CAPTION_STYLE_ID
      style.textContent = captionCss
      root.appendChild(style)
    }

    /** Header chip used when there is no desktop caption menu. */
    function HeaderChip() {
      const [state, setState] = React.useState(pollerSnapshot())
      React.useEffect(() => poller.subscribe(setState), [])

      const { data, error } = state
      const currency = data?.pricing?.currency ?? 'CNY'
      const loading = data === null && error === null
      const phase = data?.window?.phase ?? null
      const balance = error !== null && data === null ? '—' : loading ? '…' : walletNodes(data.balance, currency)
      const cost = error !== null && data === null ? '—' : loading ? '…' : amountNodes(currency, data?.today?.cost, 'cost')

      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-cb-chip',
          title: tooltip(data, error),
          'aria-label': ariaLabel(data, error),
          onClick: () => poller.refresh(true),
        },
        h('span', { className: 'dsh-cb-amount', key: 'balance' }, balance),
        h('span', { className: 'dsh-cb-sep', key: 'sep' }, '·'),
        h('span', { className: 'dsh-cb-amount', key: 'cost' }, cost),
        phase === null
          ? null
          : h('span', { className: 'dsh-cb-phase', 'data-peak': phase === 'peak', key: 'phase' }, phase === 'peak' ? '峰' : '谷'),
      )
    }

    // The poller is created per plugin apply and read by the chip component.
    let poller = null
    const pollerSnapshot = () => (poller === null ? { data: null, error: null } : poller.get())

    function apply(ctx) {
      ctx.effect(() => {
        poller = createPoller()
        let disposed = false
        let captionButton = null
        let captionUnsubscribe = null
        let mountTimer = 0
        let refreshTimer = 0
        let fallbackTimer = 0
        let fallbackRegistered = false

        const mountCaption = () => {
          if (disposed || captionButton !== null) return
          const found = findMenubar()
          if (found === null) return
          ensureCaptionStyle(found.root)
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'dsh-cb'
          button.tabIndex = -1
          button.addEventListener('click', () => poller.refresh(true))
          found.bar.appendChild(button)
          captionButton = button
          paintCaption(button, poller.get().data, poller.get().error)
          captionUnsubscribe = poller.subscribe((state) => paintCaption(captionButton, state.data, state.error))
          window.clearInterval(mountTimer)
        }

        // Try the caption menu first; fall back to the conversation header only
        // when this platform has no caption menu at all.
        mountTimer = window.setInterval(mountCaption, MOUNT_INTERVAL_MS)
        mountCaption()

        fallbackTimer = window.setTimeout(() => {
          if (disposed || captionButton !== null || fallbackRegistered) return
          window.clearInterval(mountTimer)
          fallbackRegistered = true
          try {
            ctx.slots.inject(
              FALLBACK_SLOT,
              () =>
                ctx.slots.register(
                  { name: FALLBACK_SLOT, id: 'dsh-caption-balance', order: 20 },
                  HeaderChip,
                ),
              'dsh-caption-balance: header chip',
            )
          } catch (error) {
            ctx?.logger?.warn?.(`[dsh-caption-balance] header chip unavailable: ${error?.message ?? error}`)
          }
        }, FALLBACK_DELAY_MS)

        refreshTimer = window.setInterval(() => poller.refresh(false), REFRESH_MS)
        poller.refresh(false)

        const onVisible = () => {
          if (document.visibilityState === 'visible') poller.refresh(false)
        }
        document.addEventListener('visibilitychange', onVisible)

        return () => {
          disposed = true
          window.clearInterval(mountTimer)
          window.clearInterval(refreshTimer)
          window.clearTimeout(fallbackTimer)
          document.removeEventListener('visibilitychange', onVisible)
          captionUnsubscribe?.()
          if (captionButton !== null) captionButton.remove()
          captionButton = null
          poller = null
        }
      }, 'dsh-caption-balance: mount')
    }

    return { inject: ['slots'], apply }
  },
})
