/**
 * Client half of dsh-caption-balance.
 *
 * One data source, three render targets selected by the `display.position`
 * setting from the host route:
 *
 * - `caption` — the Windows desktop caption menu, appended after 编辑, reusing
 *   its button styling (only works where the desktop preload injects it)
 * - `header` — the conversation header's utilities slot
 * - `sidebar` — the sidebar footer row, sized like the navigation rows
 * - `auto` — caption when that menu exists, otherwise the header chip
 *
 * `display.showBalance` / `showToday` / `showPhase` choose the segments,
 * `display.smallDecimals` turns the smaller decimal run off, and a balance below
 * `display.lowBalanceThreshold` is tinted with the configured warn/danger tone.
 *
 * A `settings.section` page edits those switches inside the Harness settings
 * dialog; it reads and writes the host's settings route.
 */
window.__ModuleLoader__.load({
  id: 'dsh-caption-balance',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const ROUTE = '/api/dsh-caption-balance/summary'
    const SETTINGS_ROUTE = '/api/dsh-caption-balance/settings'
    const SETTINGS_HEADER = 'x-dsh-caption-balance'
    const MENU_HOST = '[data-windows-menu]'
    const MENUBAR = '[role="menubar"]'
    const CAPTION_STYLE_ID = 'dsh-caption-balance-caption-style'
    const CHIP_STYLE_ID = 'dsh-caption-balance-chip-style'
    const SETTINGS_STYLE_ID = 'dsh-caption-balance-settings-style'
    const HEADER_SLOT = 'conversation.session.header.utilities'
    const SIDEBAR_SLOT = 'sidebar.footer.action'
    const SETTINGS_SLOT = 'settings.section'
    const PLUGINS_BUNDLE_CONFIG = 'plugins.bundle.config'
    const BUNDLE_NAME = 'dsh-caption-balance'
    const MOUNT_INTERVAL_MS = 500
    const FALLBACK_DELAY_MS = 4_000
    const REFRESH_MS = 30_000

    const POSITIONS = new Set(['auto', 'caption', 'header', 'sidebar'])
    const TONES = new Set(['warn', 'danger', 'gradient'])
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
    const GRADIENT_DEFAULTS = Object.freeze({
      fromAmount: 0,
      fromColor: '#e5484d',
      toAmount: 50,
      toColor: '#22c55e',
    })

    const captionCss = `
button.dsh-cb {
  display: inline-flex; align-items: baseline;
  height: 28px; line-height: 28px;
  font-variant-numeric: tabular-nums;
}
button.dsh-cb .dsh-cb-dec { font-size: 0.82em; opacity: 0.8; }
button.dsh-cb .dsh-cb-sep { margin: 0 4px; opacity: 0.45; }
button.dsh-cb .dsh-cb-phase { margin-left: 6px; font-size: 12px; line-height: inherit; color: var(--dsw-alias-label-tertiary); }
button.dsh-cb .dsh-cb-phase--first { margin-left: 0; }
button.dsh-cb .dsh-cb-phase[data-peak='true'] { color: var(--dsw-alias-state-warn-label, #d9a441); }
button.dsh-cb .dsh-cb-low[data-tone='warn'] { color: var(--dsw-alias-state-warn-label, #d9a441); }
button.dsh-cb .dsh-cb-low[data-tone='danger'] { color: var(--dsw-alias-state-danger-label, #e5484d); }
`

    const chipCss = `
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
.dsh-cb-side {
  display: flex; align-items: center; gap: 6px;
  width: 100%; min-width: 0; min-height: 36px; box-sizing: border-box;
  margin: 0; padding: 7px 9px; border: 0;
  border-inline: 3px solid transparent;
  border-radius: var(--dsw-radius-md, 8px);
  background: transparent; color: var(--dsw-alias-label-secondary, inherit);
  font-family: inherit; font-size: 14px; line-height: 22px;
  text-align: left; cursor: pointer; font-variant-numeric: tabular-nums;
}
.dsh-cb-side:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14)); }
.dsh-cb-side:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe); outline-offset: -2px; }
.dsh-cb-side .dsh-cb-icon { flex: none; display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-secondary, currentColor); }
.dsh-cb-chip .dsh-cb-dec, .dsh-cb-side .dsh-cb-dec { font-size: 0.82em; opacity: 0.8; }
.dsh-cb-chip .dsh-cb-sep, .dsh-cb-side .dsh-cb-sep { margin: 0 4px; opacity: 0.45; }
.dsh-cb-chip .dsh-cb-phase, .dsh-cb-side .dsh-cb-phase { margin-left: 6px; font-size: 12px; color: var(--dsw-alias-label-tertiary, inherit); }
.dsh-cb-chip .dsh-cb-phase--first, .dsh-cb-side .dsh-cb-phase--first { margin-left: 0; }
.dsh-cb-chip .dsh-cb-phase[data-peak='true'], .dsh-cb-side .dsh-cb-phase[data-peak='true'] { color: var(--dsw-alias-state-warn-label, #d9a441); }
.dsh-cb-chip .dsh-cb-low[data-tone='warn'], .dsh-cb-side .dsh-cb-low[data-tone='warn'] { color: var(--dsw-alias-state-warn-label, #d9a441); }
.dsh-cb-chip .dsh-cb-low[data-tone='danger'], .dsh-cb-side .dsh-cb-low[data-tone='danger'] { color: var(--dsw-alias-state-danger-label, #e5484d); }
`

    const settingsCss = `
.dsh-cb-settings { display: flex; flex-direction: column; gap: 16px; padding: 8px 0; font-size: 13px; line-height: 22px; color: var(--dsw-alias-label-primary); }
.dsh-cb-settings__intro { color: var(--dsw-alias-label-secondary); margin: 0; }
.dsh-cb-settings__card { border: .5px solid var(--dsw-alias-settings-card-stroke); border-radius: var(--dsw-radius-xl); background: var(--dsw-alias-settings-card-fill); padding: 4px 16px; }
.dsh-cb-settings__row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 44px; padding: 6px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dsh-cb-settings__row:last-child { border-bottom: 0; }
.dsh-cb-settings__label { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dsh-cb-settings__name { font-size: 14px; }
.dsh-cb-settings__hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dsh-cb-settings select, .dsh-cb-settings input[type=number] { height: 32px; box-sizing: border-box; border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); font: inherit; padding: 0 10px; min-width: 150px; }
.dsh-cb-settings input[type=color] { width: 44px; height: 32px; box-sizing: border-box; padding: 2px; border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); }
.dsh-cb-settings__pair { display: flex; align-items: center; gap: 8px; }
.dsh-cb-settings__pair input[type=number] { min-width: 90px; width: 90px; }
.dsh-cb-settings__gradientRow { display: flex; flex-direction: column; gap: 4px; padding: 0 0 10px; }
.dsh-cb-settings__gradient { height: 10px; border-radius: 999px; }
.dsh-cb-settings__gradientLabels { display: flex; justify-content: space-between; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh-cb-settings input[type=checkbox] { width: 16px; height: 16px; accent-color: var(--dsw-alias-brand-primary); }
.dsh-cb-settings__actions { display: flex; align-items: center; gap: 12px; }
.dsh-cb-settings__save { height: 32px; padding: 0 14px; border-radius: var(--dsw-radius-md); border: 0; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); font: inherit; font-weight: 500; cursor: pointer; }
.dsh-cb-settings__save:disabled { opacity: .6; cursor: default; }
.dsh-cb-settings__reset { height: 32px; padding: 0 14px; border-radius: var(--dsw-radius-md); border: .5px solid var(--dsw-alias-border-l4); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; cursor: pointer; }
.dsh-cb-settings__reset:disabled { opacity: .6; cursor: default; }
.dsh-cb-settings__status { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh-cb-settings__status[data-tone=error] { color: var(--dsw-alias-state-error-primary); }
`

    const currencySymbol = (currency) => (currency === 'USD' ? '$' : currency === 'CNY' ? '\u00a5' : '')

    /** Two-language copy for the settings page. */
    const COPY = {
      zh: {
        nav: '余额显示',
        intro: '标题栏 / 会话标题栏里的余额读数。修改后点保存，立即生效。',
        position: '显示位置',
        positionHint: 'auto：有标题栏菜单就放标题栏，否则放会话标题栏',
        showBalance: '显示余额',
        showToday: '显示今日花费',
        showPhase: '显示峰 / 谷',
        smallDecimals: '小数部分小一号',
        lowThreshold: '低余额阈值',
        lowThresholdHint: '余额低于该金额时变色，0 表示关闭',
        lowStyle: '低余额颜色',
        warn: '琥珀色',
        danger: '红色',
        gradient: '渐变',
        gradientFrom: '渐变起点',
        gradientFromHint: '余额不高于该金额时显示起点颜色',
        gradientTo: '渐变终点',
        gradientToHint: '余额不低于该金额时显示终点颜色，中间按比例过渡',
        amount: '金额',
        colour: '颜色',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        failed: '保存失败',
        reset: '恢复默认',
        restored: '已恢复默认',
        loading: '读取中…',
      },
      en: {
        nav: 'Balance display',
        intro: 'The balance reading in the title bar or session header. Save applies immediately.',
        position: 'Position',
        positionHint: 'auto: caption menu when present, otherwise the session header',
        showBalance: 'Show balance',
        showToday: "Show today's spend",
        showPhase: 'Show peak / off-peak',
        smallDecimals: 'Smaller decimals',
        lowThreshold: 'Low balance threshold',
        lowThresholdHint: 'Tint below this amount; 0 disables',
        lowStyle: 'Low balance colour',
        warn: 'Amber',
        danger: 'Red',
        gradient: 'Gradient',
        gradientFrom: 'Gradient start',
        gradientFromHint: 'At or below this amount the balance takes the start colour',
        gradientTo: 'Gradient end',
        gradientToHint: 'At or above this amount the balance takes the end colour; the range in between is interpolated',
        amount: 'Amount',
        colour: 'Colour',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        failed: 'Save failed',
        reset: 'Reset to defaults',
        restored: 'Defaults restored',
        loading: 'Loading…',
      },
    }

    const pageLanguage = () => (
      String(document.documentElement?.lang ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
    )
    const copy = () => COPY[pageLanguage()]

    /** Validate the display block the host shipped, so an old host still works. */
    function displayOf(data) {
      const source = data?.display !== null && typeof data?.display === 'object' ? data.display : {}
      const gradientFromAmount = Number.isFinite(Number(source.gradientFromAmount))
        ? Math.max(0, Number(source.gradientFromAmount))
        : GRADIENT_DEFAULTS.fromAmount
      const gradientToAmount = Number.isFinite(Number(source.gradientToAmount))
        ? Math.max(0, Number(source.gradientToAmount))
        : GRADIENT_DEFAULTS.toAmount
      const gradientRange = gradientToAmount > gradientFromAmount
      return {
        position: POSITIONS.has(source.position) ? source.position : 'auto',
        showBalance: source.showBalance !== false,
        showToday: source.showToday !== false,
        showPhase: source.showPhase !== false,
        smallDecimals: source.smallDecimals !== false,
        lowBalanceThreshold: Number.isFinite(Number(source.lowBalanceThreshold))
          ? Math.max(0, Number(source.lowBalanceThreshold))
          : 10,
        lowBalanceStyle: TONES.has(source.lowBalanceStyle) ? source.lowBalanceStyle : 'warn',
        gradientFromAmount: gradientRange ? gradientFromAmount : GRADIENT_DEFAULTS.fromAmount,
        gradientToAmount: gradientRange ? gradientToAmount : GRADIENT_DEFAULTS.toAmount,
        gradientFromColor: HEX_COLOR.test(source.gradientFromColor)
          ? String(source.gradientFromColor).toLowerCase()
          : GRADIENT_DEFAULTS.fromColor,
        gradientToColor: HEX_COLOR.test(source.gradientToColor)
          ? String(source.gradientToColor).toLowerCase()
          : GRADIENT_DEFAULTS.toColor,
      }
    }

    /** Format one amount, returning its integer and decimal halves separately. */
    function splitMoney(currency, value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return null
      const absolute = Math.abs(number)
      // Money keeps a fixed number of decimals so the caption never jitters
      // between ¥59.6 and ¥59.60 as the value changes.
      const decimals = absolute < 0.01 ? 4 : absolute < 1 ? 3 : 2
      const text = number.toFixed(decimals)
      const dot = text.indexOf('.')
      return dot < 0
        ? { symbol: currencySymbol(currency), integer: text, decimal: '' }
        : { symbol: currencySymbol(currency), integer: text.slice(0, dot), decimal: text.slice(dot) }
    }

    /** One amount, with the decimal run optionally one step smaller, as HTML. */
    function amountMarkup(currency, value, smallDecimals) {
      const parts = splitMoney(currency, value)
      if (parts === null) return '—'
      if (parts.decimal.length === 0 || smallDecimals === false) {
        return `${parts.symbol}${parts.integer}${parts.decimal}`
      }
      return `${parts.symbol}${parts.integer}<span class="dsh-cb-dec">${parts.decimal}</span>`
    }

    /** The same amount as React nodes. */
    function amountNodes(currency, value, smallDecimals, key) {
      const parts = splitMoney(currency, value)
      if (parts === null) return h('span', { key }, '—')
      if (parts.decimal.length === 0 || smallDecimals === false) {
        return h('span', { key }, `${parts.symbol}${parts.integer}${parts.decimal}`)
      }
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

    function walletMarkup(balance, currency, smallDecimals) {
      if (balance === null || balance === undefined) return '…'
      if (balance.status !== 'ready') return walletSummary(balance, currency)
      const wallets = Array.isArray(balance.wallets) ? balance.wallets : []
      if (wallets.length === 0) return '—'
      return wallets
        .map((wallet, index) => `${index > 0 ? ' / ' : ''}${amountMarkup(wallet.currency ?? currency, wallet.balance, smallDecimals)}`)
        .join('')
    }

    function walletNodes(balance, currency, smallDecimals) {
      if (balance === null || balance === undefined) return [h('span', { key: 'x' }, '…')]
      if (balance.status !== 'ready') return [h('span', { key: 'x' }, walletSummary(balance, currency))]
      const wallets = Array.isArray(balance.wallets) ? balance.wallets : []
      if (wallets.length === 0) return [h('span', { key: 'x' }, '—')]
      const nodes = []
      wallets.forEach((wallet, index) => {
        if (index > 0) nodes.push(h('span', { key: `sep-${index}` }, ' / '))
        nodes.push(amountNodes(wallet.currency ?? currency, wallet.balance, smallDecimals, `w-${index}`))
      })
      return nodes
    }

    /** Total of the wallets in the display currency, or null when unknown. */
    function walletTotal(balance, currency) {
      if (balance === null || balance === undefined || balance.status !== 'ready') return null
      const wallets = Array.isArray(balance.wallets) ? balance.wallets : []
      const matching = wallets.filter((wallet) => (wallet.currency ?? currency) === currency)
      const chosen = matching.length > 0 ? matching : wallets
      let total = 0
      let seen = false
      for (const wallet of chosen) {
        const number = Number(wallet.balance)
        if (!Number.isFinite(number)) continue
        total += number
        seen = true
      }
      return seen ? total : null
    }

    /** Parse `#rrggbb` into its three channels. */
    function hexChannels(hex) {
      return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
    }

    /** Linear RGB interpolation between two `#rrggbb` colours. */
    function mixHex(from, to, ratio) {
      const start = hexChannels(from)
      const end = hexChannels(to)
      const channels = start.map((value, index) => {
        const mixed = Math.round(value + (end[index] - value) * ratio)
        return Math.max(0, Math.min(255, mixed)).toString(16).padStart(2, '0')
      })
      return `#${channels.join('')}`
    }

    /**
     * The balance tint: `{ tone }` for the warn/danger styles, or `{ color }`
     * with an interpolated `#rrggbb` for the gradient style.
     */
    function lowBalanceState(data, display) {
      const currency = data?.pricing?.currency ?? 'CNY'
      const total = walletTotal(data?.balance, currency)
      if (total === null) return null
      if (display.lowBalanceStyle === 'gradient') {
        const fromAmount = display.gradientFromAmount
        const toAmount = display.gradientToAmount
        if (!(toAmount > fromAmount)) return null
        if (total <= fromAmount) return { color: display.gradientFromColor }
        if (total >= toAmount) return { color: display.gradientToColor }
        return {
          color: mixHex(
            display.gradientFromColor,
            display.gradientToColor,
            (total - fromAmount) / (toAmount - fromAmount),
          ),
        }
      }
      if (!(display.lowBalanceThreshold > 0)) return null
      if (total >= display.lowBalanceThreshold) return null
      return { tone: display.lowBalanceStyle === 'danger' ? 'danger' : 'warn' }
    }

    function bonusText(balance, currency) {
      const wallets = balance !== null && balance !== undefined && balance.status === 'ready'
        && Array.isArray(balance.bonusWallets) ? balance.bonusWallets : []
      const positive = wallets.filter((wallet) => Number(wallet.balance) > 0)
      if (positive.length === 0) return ''
      return positive.map((wallet) => amountText(wallet.currency ?? currency, wallet.balance)).join(' / ')
    }

    /** Multi-line native tooltip describing every number behind the widget. */
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

    /** Every segment currently visible, in display order. */
    function segmentsOf(data, error, display) {
      const currency = data?.pricing?.currency ?? 'CNY'
      const loading = data === null
      const failed = error !== null && data === null
      const low = error === null && data !== null ? lowBalanceState(data, display) : null

      return {
        currency,
        low,
        balance: display.showBalance
          ? (failed ? '—' : loading ? '…' : walletMarkup(data.balance, currency, display.smallDecimals))
          : '',
        cost: display.showToday ? (failed ? '—' : loading ? '…' : amountMarkup(currency, data?.today?.cost, display.smallDecimals)) : '',
        phase: display.showPhase ? data?.window?.phase ?? null : null,
      }
    }

    /** Fill the caption button with the visible segments. */
    function paintCaption(button, state, display) {
      if (button === null) return
      const view = segmentsOf(state.data, state.error, display)
      const low = view.low
      const parts = []
      if (view.balance !== '') {
        const lowClass = low === null ? '' : ' dsh-cb-low'
        const lowAttribute = low === null
          ? ''
          : low.color === undefined
            ? ` data-tone="${low.tone}"`
            : ` style="color:${low.color}"`
        parts.push(`<span class="dsh-cb-balance${lowClass}"${lowAttribute}>${view.balance}</span>`)
      }
      if (view.cost !== '') {
        if (parts.length > 0) parts.push('<span class="dsh-cb-sep">·</span>')
        parts.push(`<span class="dsh-cb-cost">${view.cost}</span>`)
      }
      if (view.phase !== null) {
        const first = parts.length === 0
        parts.push(
          `<span class="dsh-cb-phase${first ? ' dsh-cb-phase--first' : ''}" data-peak="${view.phase === 'peak'}">${view.phase === 'peak' ? '峰' : '谷'}</span>`,
        )
      }
      if (parts.length === 0) parts.push('<span class="dsh-cb-balance">—</span>')
      button.innerHTML = parts.join('')
      button.title = tooltip(state.data, state.error)
      button.setAttribute('aria-label', ariaLabel(state.data, state.error))
    }

    /** Shared poller: one request loop feeding every mounted target. */
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

    // The poller is created per apply and read by the components below.
    let poller = null
    const pollerSnapshot = () => (poller === null ? { data: null, error: null } : poller.get())

    /** Find the caption menubar inside the preload's open shadow root. */
    function findMenubar() {
      const host = document.querySelector(MENU_HOST)
      if (host === null || host.shadowRoot === null) return null
      const bar = host.shadowRoot.querySelector(MENUBAR)
      return bar === null ? null : { root: host.shadowRoot, bar }
    }

    function ensureStyle(id, css, parent) {
      // parent may be a ShadowRoot or a plain element such as document.head;
      // only Document has getElementById, so every case goes through querySelector.
      if (parent.querySelector('#' + id) !== null) return
      const style = document.createElement('style')
      style.id = id
      style.textContent = css
      parent.appendChild(style)
    }

    /** Read the settings route; resolves to the display block plus defaults. */
    async function fetchSettings() {
      const response = await fetch(SETTINGS_ROUTE, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      if (payload?.ok !== true) throw new Error(payload?.error ?? 'bad payload')
      return payload
    }

    /** Persist the display block through the settings route. */
    async function saveSettings(display) {
      const response = await fetch(SETTINGS_ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          [SETTINGS_HEADER]: '1',
        },
        body: JSON.stringify({ display }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok !== true) {
        throw new Error(payload?.error ?? `HTTP ${response.status}`)
      }
      return payload
    }

    /** Header chip, used when the caption menu is not the chosen target. */
    function HeaderChip() {
      const [state, setState] = React.useState(pollerSnapshot())
      React.useEffect(() => poller.subscribe(setState), [])
      const display = displayOf(state.data)
      const view = segmentsOf(state.data, state.error, display)

      const children = []
      if (view.balance !== '') {
        const lowProps = view.low === null
          ? {}
          : view.low.color === undefined
            ? { 'data-tone': view.low.tone }
            : { style: { color: view.low.color } }
        children.push(h('span', { className: `dsh-cb-balance${view.low === null ? '' : ' dsh-cb-low'}`, key: 'balance', ...lowProps }, view.balance))
      }
      if (view.cost !== '') {
        if (children.length > 0) children.push(h('span', { className: 'dsh-cb-sep', key: 'sep' }, '·'))
        children.push(h('span', { className: 'dsh-cb-cost', key: 'cost' }, view.cost))
      }
      if (view.phase !== null) {
        children.push(
          h(
            'span',
            { className: `dsh-cb-phase${children.length === 0 ? ' dsh-cb-phase--first' : ''}`, 'data-peak': view.phase === 'peak', key: 'phase' },
            view.phase === 'peak' ? '峰' : '谷',
          ),
        )
      }

      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-cb-chip',
          title: tooltip(state.data, state.error),
          'aria-label': ariaLabel(state.data, state.error),
          onClick: () => poller.refresh(true),
        },
        children,
      )
    }

    function WalletIcon() {
      return h(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: false },
        h('rect', { x: 1.2, y: 3.6, width: 13.6, height: 8.8, rx: 2, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', { d: 'M1.2 6.4h13.6', stroke: 'currentColor', strokeWidth: 1.2 }),
        h('circle', { cx: 11.4, cy: 9.6, r: 1.2, fill: 'currentColor' }),
      )
    }

    /** Sidebar footer row, laid out like the navigation rows. */
    function SidebarRow() {
      const [state, setState] = React.useState(pollerSnapshot())
      React.useEffect(() => poller.subscribe(setState), [])
      const display = displayOf(state.data)
      const view = segmentsOf(state.data, state.error, display)

      const children = []
      if (view.balance !== '') {
        const lowProps = view.low === null
          ? {}
          : view.low.color === undefined
            ? { 'data-tone': view.low.tone }
            : { style: { color: view.low.color } }
        children.push(h('span', { className: `dsh-cb-balance${view.low === null ? '' : ' dsh-cb-low'}`, key: 'balance', ...lowProps }, view.balance))
      }
      if (view.cost !== '') {
        if (children.length > 0) children.push(h('span', { className: 'dsh-cb-sep', key: 'sep' }, '·'))
        children.push(h('span', { className: 'dsh-cb-cost', key: 'cost' }, view.cost))
      }
      if (view.phase !== null) {
        children.push(
          h(
            'span',
            { className: `dsh-cb-phase${children.length === 0 ? ' dsh-cb-phase--first' : ''}`, 'data-peak': view.phase === 'peak', key: 'phase' },
            view.phase === 'peak' ? '峰' : '谷',
          ),
        )
      }

      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-cb-side',
          title: tooltip(state.data, state.error),
          'aria-label': ariaLabel(state.data, state.error),
          onClick: () => poller.refresh(true),
        },
        h('span', { className: 'dsh-cb-icon', key: 'icon' }, h(WalletIcon)),
        children,
      )
    }

    /** One labelled row in the settings form. */
    function Row(props) {
      return h(
        'div',
        { className: 'dsh-cb-settings__row' },
        h(
          'div',
          { className: 'dsh-cb-settings__label' },
          h('span', { className: 'dsh-cb-settings__name' }, props.name),
          props.hint === undefined ? null : h('span', { className: 'dsh-cb-settings__hint' }, props.hint),
        ),
        props.children,
      )
    }

    function Toggle(props) {
      return h('input', {
        type: 'checkbox',
        checked: props.checked,
        onChange: (event) => props.onChange(event.target.checked),
        'aria-label': props.name,
      })
    }

    /** Settings page contributed to the Harness settings dialog. */
    function SettingsSection() {
      const text = copy()
      const [draft, setDraft] = React.useState(null)
      const [defaults, setDefaults] = React.useState(null)
      const [status, setStatus] = React.useState('loading')
      const [error, setError] = React.useState(null)

      React.useEffect(() => {
        let live = true
        fetchSettings()
          .then((payload) => {
            if (!live) return
            setDraft(displayOf(payload))
            setDefaults(displayOf({ display: payload?.defaults }))
            setStatus('ready')
          })
          .catch((cause) => {
            if (!live) return
            setDraft(displayOf(null))
            setDefaults(displayOf(null))
            setStatus('ready')
            setError(String(cause?.message ?? cause))
          })
        return () => {
          live = false
        }
      }, [])

      const update = (patch) => setDraft((current) => ({ ...(current ?? displayOf(null)), ...patch }))

      const save = () => {
        if (draft === null) return
        setStatus('saving')
        setError(null)
        saveSettings(draft)
          .then((payload) => {
            setDraft(displayOf(payload))
            setStatus('saved')
            // Repaint the mounted widget right away instead of waiting for its poll.
            poller?.refresh(false)
          })
          .catch((cause) => {
            setStatus('ready')
            setError(String(cause?.message ?? cause))
          })
      }

      // Restore the deployment defaults in one click: fill the form and persist
      // them, so the widget and every other entrance see the same values.
      const restore = () => {
        if (status === 'saving') return
        const base = defaults ?? displayOf(null)
        setDraft(base)
        setStatus('saving')
        setError(null)
        saveSettings(base)
          .then((payload) => {
            setDraft(displayOf(payload))
            setStatus('restored')
            poller?.refresh(false)
          })
          .catch((cause) => {
            setStatus('ready')
            setError(String(cause?.message ?? cause))
          })
      }

      if (draft === null) return h('div', { className: 'dsh-cb-settings' }, h('p', { className: 'dsh-cb-settings__intro' }, text.loading))

      const positionOptions = [
        ['auto', 'auto'],
        ['caption', 'caption'],
        ['header', 'header'],
        ['sidebar', 'sidebar'],
      ]

      return h(
        'div',
        { className: 'dsh-cb-settings' },
        h('p', { className: 'dsh-cb-settings__intro' }, text.intro),
        h(
          'div',
          { className: 'dsh-cb-settings__card' },
          h(
            Row,
            { name: text.position, hint: text.positionHint },
            h(
              'select',
              {
                value: draft.position,
                onChange: (event) => update({ position: event.target.value }),
                'aria-label': text.position,
              },
              positionOptions.map(([value, label]) => h('option', { value, key: value }, label)),
            ),
          ),
          h(Row, { name: text.showBalance }, h(Toggle, { name: text.showBalance, checked: draft.showBalance, onChange: (value) => update({ showBalance: value }) })),
          h(Row, { name: text.showToday }, h(Toggle, { name: text.showToday, checked: draft.showToday, onChange: (value) => update({ showToday: value }) })),
          h(Row, { name: text.showPhase }, h(Toggle, { name: text.showPhase, checked: draft.showPhase, onChange: (value) => update({ showPhase: value }) })),
          h(Row, { name: text.smallDecimals }, h(Toggle, { name: text.smallDecimals, checked: draft.smallDecimals, onChange: (value) => update({ smallDecimals: value }) })),
          draft.lowBalanceStyle === 'gradient'
            ? null
            : h(
                Row,
                { name: text.lowThreshold, hint: text.lowThresholdHint },
                h('input', {
                  type: 'number',
                  min: 0,
                  step: 1,
                  value: String(draft.lowBalanceThreshold),
                  onChange: (event) => update({ lowBalanceThreshold: Math.max(0, Number(event.target.value) || 0) }),
                  'aria-label': text.lowThreshold,
                }),
              ),
          h(
            Row,
            { name: text.lowStyle },
            h(
              'select',
              {
                value: draft.lowBalanceStyle,
                onChange: (event) => update({ lowBalanceStyle: event.target.value }),
                'aria-label': text.lowStyle,
              },
              h('option', { value: 'warn' }, text.warn),
              h('option', { value: 'danger' }, text.danger),
              h('option', { value: 'gradient' }, text.gradient),
            ),
          ),
          draft.lowBalanceStyle === 'gradient'
            ? h(
                Row,
                { name: text.gradientFrom, hint: text.gradientFromHint },
                h(
                  'div',
                  { className: 'dsh-cb-settings__pair' },
                  h('input', {
                    type: 'number',
                    min: 0,
                    step: 1,
                    value: String(draft.gradientFromAmount),
                    onChange: (event) => update({ gradientFromAmount: Math.max(0, Number(event.target.value) || 0) }),
                    'aria-label': `${text.gradientFrom} ${text.amount}`,
                  }),
                  h('input', {
                    type: 'color',
                    value: draft.gradientFromColor,
                    onChange: (event) => update({ gradientFromColor: String(event.target.value).toLowerCase() }),
                    'aria-label': `${text.gradientFrom} ${text.colour}`,
                  }),
                ),
              )
            : null,
          draft.lowBalanceStyle === 'gradient'
            ? h(
                Row,
                { name: text.gradientTo, hint: text.gradientToHint },
                h(
                  'div',
                  { className: 'dsh-cb-settings__pair' },
                  h('input', {
                    type: 'number',
                    min: 0,
                    step: 1,
                    value: String(draft.gradientToAmount),
                    onChange: (event) => update({ gradientToAmount: Math.max(0, Number(event.target.value) || 0) }),
                    'aria-label': `${text.gradientTo} ${text.amount}`,
                  }),
                  h('input', {
                    type: 'color',
                    value: draft.gradientToColor,
                    onChange: (event) => update({ gradientToColor: String(event.target.value).toLowerCase() }),
                    'aria-label': `${text.gradientTo} ${text.colour}`,
                  }),
                ),
              )
            : null,
          draft.lowBalanceStyle === 'gradient'
            ? h(
                'div',
                { className: 'dsh-cb-settings__gradientRow' },
                h('div', {
                  className: 'dsh-cb-settings__gradient',
                  style: {
                    background: `linear-gradient(90deg, ${draft.gradientFromColor}, ${draft.gradientToColor})`,
                  },
                }),
                h(
                  'div',
                  { className: 'dsh-cb-settings__gradientLabels' },
                  h('span', {}, String(draft.gradientFromAmount)),
                  h('span', {}, String(draft.gradientToAmount)),
                ),
              )
            : null,
        ),
        h(
          'div',
          { className: 'dsh-cb-settings__actions' },
          h(
            'button',
            { type: 'button', className: 'dsh-cb-settings__save', onClick: save, disabled: status === 'saving' },
            status === 'saving' ? text.saving : text.save,
          ),
          h(
            'button',
            { type: 'button', className: 'dsh-cb-settings__reset', onClick: restore, disabled: status === 'saving' },
            text.reset,
          ),
          status === 'saved' ? h('span', { className: 'dsh-cb-settings__status' }, text.saved) : null,
          status === 'restored' ? h('span', { className: 'dsh-cb-settings__status' }, text.restored) : null,
          error === null ? null : h('span', { className: 'dsh-cb-settings__status', 'data-tone': 'error' }, `${text.failed}: ${error}`),
        ),
      )
    }

    function apply(ctx) {
      ctx.effect(() => {
        poller = createPoller()
        let disposed = false
        let captionButton = null
        let captionUnsubscribe = null
        let mountTimer = 0
        let fallbackTimer = 0
        let refreshTimer = 0
        let registered = false

        // The settings page is independent of the render target, so it is
        // registered up front and appears in the settings dialog's navigation.
        // The slot may not be declared this early in a cold web boot, so a
        // failed attempt is logged and retried instead of failing the whole
        // client entry.
        let settingsRegistered = false
        let settingsAttempts = 0
        let settingsTimer = 0
        const registerSettingsSection = () => {
          if (disposed || settingsRegistered) return
          settingsAttempts += 1
          try {
            ensureStyle(SETTINGS_STYLE_ID, settingsCss, document.head)
            ctx.slots.inject(
              SETTINGS_SLOT,
              () =>
                ctx.slots.register(
                  {
                    name: SETTINGS_SLOT,
                    id: 'dsh-caption-balance',
                    order: 60,
                    label: () => copy().nav,
                  },
                  SettingsSection,
                ),
              'dsh-caption-balance: settings section',
            )
            settingsRegistered = true
          } catch (error) {
            console.error('[dsh-caption-balance] settings section unavailable', error)
            if (settingsAttempts < 20) settingsTimer = window.setTimeout(registerSettingsSection, 1000)
          }
        }
        registerSettingsSection()

        // A bundle's own configuration belongs on the Plugins page: the page
        // renders `plugins.bundle.config` keyed by the bundle package name
        // between the bundle description and its rows. Contribute the same
        // form there so the switches are reachable from the plugin card.
        let pluginsConfigRegistered = false
        let pluginsConfigAttempts = 0
        let pluginsConfigTimer = 0
        const registerPluginsConfig = () => {
          if (disposed || pluginsConfigRegistered) return
          pluginsConfigAttempts += 1
          try {
            ensureStyle(SETTINGS_STYLE_ID, settingsCss, document.head)
            ctx.slots.inject(
              PLUGINS_BUNDLE_CONFIG,
              () =>
                ctx.slots.register(
                  { name: PLUGINS_BUNDLE_CONFIG, key: BUNDLE_NAME, order: 20 },
                  SettingsSection,
                ),
              'dsh-caption-balance: plugins config',
            )
            pluginsConfigRegistered = true
          } catch (error) {
            console.error('[dsh-caption-balance] plugins config unavailable', error)
            if (pluginsConfigAttempts < 20) pluginsConfigTimer = window.setTimeout(registerPluginsConfig, 1000)
          }
        }
        registerPluginsConfig()

        const registerSlot = (name, component) => {
          if (registered) return
          registered = true
          try {
            ctx.slots.inject(
              name,
              () => ctx.slots.register({ name, id: 'dsh-caption-balance', order: 20 }, component),
              `dsh-caption-balance: ${name}`,
            )
          } catch (error) {
            ctx?.logger?.warn?.(`[dsh-caption-balance] slot ${name} unavailable: ${error?.message ?? error}`)
          }
        }

        const mountCaption = () => {
          if (disposed || captionButton !== null) return
          const found = findMenubar()
          if (found === null) return
          ensureStyle(CAPTION_STYLE_ID, captionCss, found.root)
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'dsh-cb'
          button.tabIndex = -1
          button.addEventListener('click', () => poller.refresh(true))
          found.bar.appendChild(button)
          captionButton = button
          paintCaption(button, poller.get(), displayOf(poller.get().data))
          captionUnsubscribe = poller.subscribe((state) => paintCaption(captionButton, state, displayOf(state.data)))
          window.clearInterval(mountTimer)
        }

        const boot = async () => {
          await poller.refresh(false)
          if (disposed) return
          const display = displayOf(poller.get().data)
          if (display.position === 'header') {
            ensureStyle(CHIP_STYLE_ID, chipCss, document.head)
            registerSlot(HEADER_SLOT, HeaderChip)
            return
          }
          if (display.position === 'sidebar') {
            ensureStyle(CHIP_STYLE_ID, chipCss, document.head)
            registerSlot(SIDEBAR_SLOT, SidebarRow)
            return
          }
          // `auto` and `caption` both mount into the caption menu.
          mountTimer = window.setInterval(mountCaption, MOUNT_INTERVAL_MS)
          mountCaption()
          if (display.position === 'auto') {
            fallbackTimer = window.setTimeout(() => {
              if (disposed || captionButton !== null || registered) return
              window.clearInterval(mountTimer)
              ensureStyle(CHIP_STYLE_ID, chipCss, document.head)
              registerSlot(HEADER_SLOT, HeaderChip)
            }, FALLBACK_DELAY_MS)
          }
        }

        refreshTimer = window.setInterval(() => poller.refresh(false), REFRESH_MS)
        const onVisible = () => {
          if (document.visibilityState === 'visible') poller.refresh(false)
        }
        document.addEventListener('visibilitychange', onVisible)
        boot().catch((error) => {
          console.error('[dsh-caption-balance] client boot failed', error)
        })

        return () => {
          disposed = true
          window.clearInterval(mountTimer)
          window.clearTimeout(fallbackTimer)
          window.clearTimeout(settingsTimer)
          window.clearTimeout(pluginsConfigTimer)
          window.clearInterval(refreshTimer)
          document.removeEventListener('visibilitychange', onVisible)
          captionUnsubscribe?.()
          if (captionButton !== null) captionButton.remove()
          captionButton = null
          document.getElementById(CHIP_STYLE_ID)?.remove()
          document.getElementById(SETTINGS_STYLE_ID)?.remove()
          poller = null
        }
      }, 'dsh-caption-balance: mount')
    }

    return { inject: ['slots'], apply }
  },
})
