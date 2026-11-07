/**
 * Client half of dsh-caption-balance.
 *
 * DSH renders the Windows caption menu itself: the desktop preload injects a
 * fixed `[data-windows-menu]` host with an open shadow root holding a
 * `[role=menubar]` and its 应用 / 编辑 buttons. This module appends one more
 * button to that menubar, so the reading sits right after 编辑 and inherits the
 * caption's own button styling. Data comes from the plugin's host route.
 *
 * On platforms without a caption menu (macOS, `dsh web`) the mount waits
 * forever and nothing is rendered; the host route is harmless there.
 */
window.__ModuleLoader__.load({
  id: 'dsh-caption-balance',
  factory: () => {
    const ROUTE = '/api/dsh-caption-balance/summary'
    const MENU_HOST = '[data-windows-menu]'
    const MENUBAR = '[role="menubar"]'
    const STYLE_ID = 'dsh-caption-balance-style'
    const MOUNT_INTERVAL_MS = 500
    const REFRESH_FALLBACK_MS = 30_000

    const css = `
button.dsh-cb {
  display: inline-flex; align-items: baseline;
  height: 28px; line-height: 28px;
  font-variant-numeric: tabular-nums;
}
button.dsh-cb .dsh-cb-dec { font-size: 0.82em; opacity: 0.8; }
button.dsh-cb .dsh-cb-sep { margin: 0 4px; opacity: 0.45; }
button.dsh-cb .dsh-cb-phase { margin-left: 6px; font-size: 12px; line-height: inherit; color: var(--dsw-alias-label-tertiary); }
button.dsh-cb .dsh-cb-phase[data-peak='true'] { color: var(--dsw-alias-state-warn-label, #d9a441); }
button.dsh-cb[data-busy='true'] { opacity: 0.6; }
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

    /** `¥62.69` with the decimals one step smaller. */
    function amountMarkup(currency, value) {
      const parts = splitMoney(currency, value)
      if (parts === null) return '—'
      if (parts.decimal.length === 0) return `${parts.symbol}${parts.integer}`
      return `${parts.symbol}${parts.integer}<span class="dsh-cb-dec">${parts.decimal}</span>`
    }

    /** Plain-text variant for the tooltip and aria label. */
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

    /** Fill one caption button with the latest state. */
    function paint(button, data, error) {
      const currency = data?.pricing?.currency ?? 'CNY'
      const loading = data === null && error === null
      const balance = error !== null ? '—' : loading ? '…' : walletMarkup(data.balance, currency)
      const cost = error !== null ? '—' : loading ? '…' : amountMarkup(currency, data?.today?.cost)
      const phase = error !== null || loading || data?.window === undefined || data?.window === null
        ? null
        : data.window.phase

      button.innerHTML =
        `<span class="dsh-cb-amount">${balance}</span>` +
        `<span class="dsh-cb-sep">·</span>` +
        `<span class="dsh-cb-amount">${cost}</span>` +
        (phase === null
          ? ''
          : `<span class="dsh-cb-phase" data-peak="${phase === 'peak'}">${phase === 'peak' ? '峰' : '谷'}</span>`)

      button.title = tooltip(data, error)
      const balanceLabel = error !== null ? '读取失败' : walletSummary(data?.balance, currency)
      const costLabel = error !== null ? '读取失败' : loading ? '…' : amountText(currency, data?.today?.cost)
      button.setAttribute('aria-label', `余额 ${balanceLabel}，今日花费 ${costLabel}`)
    }

    /** Find the caption menubar inside the preload's open shadow root. */
    function findMenubar() {
      const host = document.querySelector(MENU_HOST)
      if (host === null || host.shadowRoot === null) return null
      const bar = host.shadowRoot.querySelector(MENUBAR)
      return bar === null ? null : { root: host.shadowRoot, bar }
    }

    /** Ensure the widget's own stylesheet exists inside the shadow root. */
    function ensureStyle(root) {
      if (root.getElementById(STYLE_ID) !== null) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = css
      root.appendChild(style)
    }

    function apply(ctx) {
      ctx.effect(() => {
        let data = null
        let error = null
        let button = null
        let refreshTimer = 0
        let mountTimer = 0
        let disposed = false

        const repaint = () => {
          if (button !== null) paint(button, data, error)
        }

        const refresh = async (force) => {
          if (disposed) return
          if (button !== null) button.setAttribute('data-busy', 'true')
          try {
            const response = await fetch(`${ROUTE}${force === true ? '?force=1' : ''}`, {
              credentials: 'same-origin',
              headers: { accept: 'application/json' },
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const payload = await response.json()
            if (payload?.ok !== true) throw new Error(payload?.error ?? 'bad payload')
            data = payload
            error = null
          } catch (cause) {
            error = String(cause?.message ?? cause)
          } finally {
            if (button !== null) button.removeAttribute('data-busy')
            repaint()
          }
        }

        const mount = () => {
          if (disposed) return
          const found = findMenubar()
          if (found === null) {
            button = null
            return
          }
          if (button !== null && found.bar.contains(button)) return
          ensureStyle(found.root)
          const next = document.createElement('button')
          next.type = 'button'
          next.className = 'dsh-cb'
          next.tabIndex = -1
          next.addEventListener('click', () => {
            refresh(true)
          })
          found.bar.appendChild(next)
          button = next
          repaint()
          if (data === null && error === null) refresh(false)
        }

        mount()
        // Mounting is polled fast so a caption menu that appears late (window
        // re-created, locale switch) is picked up quickly; the data itself is
        // refreshed on its own slower timer.
        mountTimer = window.setInterval(mount, MOUNT_INTERVAL_MS)
        refreshTimer = window.setInterval(() => {
          if (button !== null) refresh(false)
        }, REFRESH_FALLBACK_MS)

        const onVisible = () => {
          if (document.visibilityState === 'visible') refresh(false)
        }
        document.addEventListener('visibilitychange', onVisible)

        return () => {
          disposed = true
          window.clearInterval(mountTimer)
          window.clearInterval(refreshTimer)
          document.removeEventListener('visibilitychange', onVisible)
          if (button !== null) button.remove()
          button = null
        }
      }, 'dsh-caption-balance: caption button')
    }

    return { inject: [], apply }
  },
})
