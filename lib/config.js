/**
 * Configuration normalisation for dsh-caption-balance.
 *
 * The bundle row's `config` is user-editable YAML, so every field is clamped
 * and coerced here once, and the rest of the host half only sees a frozen,
 * predictable object.
 *
 * @module dsh-caption-balance/config
 */

/** Package version, used as the client identity for account queries. */
export const VERSION = '0.5.1'

/** Defaults mirror `cordis.patch.yml`, so a row without `config` still works. */
export const DEFAULTS = Object.freeze({
  currency: 'CNY',
  refreshSeconds: 30,
  balanceRefreshSeconds: 180,
  balanceTimeoutMs: 10_000,
  peakMultiplier: 2,
  keepDays: 45,
  sessionsDir: null,
  allowHosts: Object.freeze([]),
  aliases: Object.freeze({
    'deepseek-v4-flash': 'deepseek-flash',
    'deepseek-v4-flash-vision-exp': 'deepseek-flash',
    'deepseek-v4.1-flash': 'deepseek-flash',
    'deepseek-v4-pro-0813': 'deepseek-v4-pro',
  }),
  models: Object.freeze({
    'deepseek-flash': Object.freeze({ cacheHit: 0.02, cacheMiss: 1, output: 4 }),
    'deepseek-v4-pro': Object.freeze({ cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 }),
  }),
})

/** Display defaults; the host sends the validated result to the client. */
export const DISPLAY_DEFAULTS = Object.freeze({
  /** auto (caption menu, header fallback), caption, header or sidebar. */
  position: 'auto',
  showBalance: true,
  showToday: true,
  showPhase: true,
  smallDecimals: true,
  /** Warn below this amount in currency; 0 disables the warning. */
  lowBalanceThreshold: 10,
  /** warn (amber), danger (red) or gradient (interpolate between two colours). */
  lowBalanceStyle: 'warn',
  /** Gradient start: balance at or below this amount gets "gradientFromColor". */
  gradientFromAmount: 0,
  gradientFromColor: '#e5484d',
  /** Gradient end: balance at or above this amount gets "gradientToColor". */
  gradientToAmount: 50,
  gradientToColor: '#22c55e',
})

const POSITIONS = new Set(['auto', 'caption', 'header', 'sidebar'])
const LOW_BALANCE_STYLES = new Set(['warn', 'danger', 'gradient'])
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const colorOf = (value, fallback) => (HEX_COLOR.test(value) ? value.toLowerCase() : fallback)

/** Validate the display block, keeping at least one segment visible. */
export function normalizeDisplay(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const gradientFromAmount = clampNumber(
    source.gradientFromAmount,
    0,
    DISPLAY_DEFAULTS.gradientFromAmount,
  )
  const gradientToAmount = clampNumber(
    source.gradientToAmount,
    0,
    DISPLAY_DEFAULTS.gradientToAmount,
  )
  // A zero-width or inverted range cannot be interpolated: fall back to defaults.
  const gradientRange = gradientToAmount > gradientFromAmount
  const display = {
    position: POSITIONS.has(source.position) ? source.position : DISPLAY_DEFAULTS.position,
    showBalance: source.showBalance !== false,
    showToday: source.showToday !== false,
    showPhase: source.showPhase !== false,
    smallDecimals: source.smallDecimals !== false,
    lowBalanceThreshold: clampNumber(source.lowBalanceThreshold, 0, DISPLAY_DEFAULTS.lowBalanceThreshold),
    lowBalanceStyle: LOW_BALANCE_STYLES.has(source.lowBalanceStyle)
      ? source.lowBalanceStyle
      : DISPLAY_DEFAULTS.lowBalanceStyle,
    gradientFromAmount: gradientRange
      ? gradientFromAmount
      : DISPLAY_DEFAULTS.gradientFromAmount,
    gradientToAmount: gradientRange ? gradientToAmount : DISPLAY_DEFAULTS.gradientToAmount,
    gradientFromColor: colorOf(source.gradientFromColor, DISPLAY_DEFAULTS.gradientFromColor),
    gradientToColor: colorOf(source.gradientToColor, DISPLAY_DEFAULTS.gradientToColor),
  }
  if (!display.showBalance && !display.showToday && !display.showPhase) display.showBalance = true
  return Object.freeze(display)
}

const clampNumber = (value, minimum, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(minimum, number) : fallback
}

/** Clamp one `{ cacheHit, cacheMiss, output }` price row. */
function normalizePrice(raw, fallback) {
  if (raw === null || typeof raw !== 'object') return fallback
  return {
    cacheHit: clampNumber(raw.cacheHit, 0, fallback.cacheHit),
    cacheMiss: clampNumber(raw.cacheMiss, 0, fallback.cacheMiss),
    output: clampNumber(raw.output, 0, fallback.output),
  }
}

/**
 * Turn a raw bundle-row config into the host half's settings.
 * @param raw - the row's `config` object, possibly undefined.
 * @returns a plain settings object with every field validated.
 */
export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}

  const models = {}
  const sourceModels = source.models !== null && typeof source.models === 'object' ? source.models : DEFAULTS.models
  for (const [key, price] of Object.entries(sourceModels)) {
    models[key] = normalizePrice(price, { cacheHit: 0, cacheMiss: 0, output: 0 })
  }

  const aliases = {}
  const sourceAliases = source.aliases !== null && typeof source.aliases === 'object' ? source.aliases : DEFAULTS.aliases
  for (const [from, to] of Object.entries(sourceAliases)) {
    if (typeof to === 'string' && to.length > 0) aliases[from] = to
  }

  const currency = typeof source.currency === 'string' && source.currency.length > 0
    ? source.currency
    : DEFAULTS.currency

  const sessionsDir = typeof source.sessionsDir === 'string' && source.sessionsDir.trim().length > 0
    ? source.sessionsDir.trim()
    : null

  const allowHosts = Array.isArray(source.allowHosts)
    ? source.allowHosts.filter((host) => typeof host === 'string' && host.length > 0)
    : []

  const display = normalizeDisplay(source.display)

  return Object.freeze({
    currency,
    refreshSeconds: Math.max(5, clampNumber(source.refreshSeconds, 5, DEFAULTS.refreshSeconds)),
    balanceRefreshSeconds: Math.max(0, clampNumber(source.balanceRefreshSeconds, 0, DEFAULTS.balanceRefreshSeconds)),
    balanceTimeoutMs: Math.max(1_000, clampNumber(source.balanceTimeoutMs, 1_000, DEFAULTS.balanceTimeoutMs)),
    peakMultiplier: clampNumber(source.peakMultiplier, 0.1, DEFAULTS.peakMultiplier),
    keepDays: Math.max(2, Math.round(clampNumber(source.keepDays, 2, DEFAULTS.keepDays))),
    sessionsDir,
    allowHosts: Object.freeze(allowHosts),
    display,
    aliases: Object.freeze(aliases),
    models: Object.freeze(models),
  })
}
