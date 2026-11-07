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
export const VERSION = '0.2.1'

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

  return Object.freeze({
    currency,
    refreshSeconds: Math.max(5, clampNumber(source.refreshSeconds, 5, DEFAULTS.refreshSeconds)),
    balanceRefreshSeconds: Math.max(0, clampNumber(source.balanceRefreshSeconds, 0, DEFAULTS.balanceRefreshSeconds)),
    balanceTimeoutMs: Math.max(1_000, clampNumber(source.balanceTimeoutMs, 1_000, DEFAULTS.balanceTimeoutMs)),
    peakMultiplier: clampNumber(source.peakMultiplier, 0.1, DEFAULTS.peakMultiplier),
    keepDays: Math.max(2, Math.round(clampNumber(source.keepDays, 2, DEFAULTS.keepDays))),
    sessionsDir,
    allowHosts: Object.freeze(allowHosts),
    aliases: Object.freeze(aliases),
    models: Object.freeze(models),
  })
}
