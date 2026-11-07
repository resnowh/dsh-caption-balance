/**
 * Pricing for DeepSeek Harness token usage.
 *
 * The official price list changes per model and doubles during the Beijing peak
 * window (09:00–12:00 and 14:00–18:00 on weekdays). Everything here works on
 * epoch milliseconds and derives the Beijing wall clock arithmetically, so the
 * host does not depend on the machine's timezone database.
 *
 * @module dsh-caption-balance/pricing
 */

/** Beijing is UTC+08:00 all year; no daylight saving transitions. */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Beijing wall-clock fields for one instant. */
function beijingClock(ms) {
  const shifted = new Date(ms + BEIJING_OFFSET_MS)
  return {
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  }
}

/**
 * Whether `ms` falls in a peak-priced window: Beijing time, Monday–Friday,
 * 09:00–12:00 or 14:00–18:00. Public holidays are not modelled and follow the
 * weekday rule.
 */
export function isPeakTime(ms) {
  const { weekday, hour, minute } = beijingClock(ms)
  if (weekday === 0 || weekday === 6) return false
  const minutes = hour * 60 + minute
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)
}

/** The next instant after `ms` when the phase flips (one of 09:00/12:00/14:00/18:00). */
function nextChange(ms) {
  const shifted = new Date(ms + BEIJING_OFFSET_MS)
  const year = shifted.getUTCFullYear()
  const month = shifted.getUTCMonth()
  const day = shifted.getUTCDate()
  for (let offset = 0; offset <= 8; offset += 1) {
    for (const hour of [9, 12, 14, 18]) {
      const boundary = Date.UTC(year, month, day + offset, hour) - BEIJING_OFFSET_MS
      if (boundary > ms) return boundary
    }
  }
  return ms + HOUR
}

/**
 * The pricing window in force at `now`, plus when it next changes.
 * @param now - epoch milliseconds.
 * @returns the phase (`peak` / `offpeak`), the next change instant and phase.
 */
export function currentWindow(now) {
  const phase = isPeakTime(now) ? 'peak' : 'offpeak'
  const changesAt = nextChange(now)
  return {
    phase,
    changesAt,
    nextPhase: isPeakTime(changesAt + 1) ? 'peak' : 'offpeak',
  }
}

/**
 * Resolve a model id to a key in `models`.
 * @param model - the model id reported by the provider.
 * @param models - the configured price table.
 * @param aliases - extra model id → price key mappings.
 * @returns the price key or null when the model is unpriced.
 */
export function resolvePriceKey(model, models, aliases) {
  if (typeof model !== 'string' || model.length === 0) return null
  if (Object.prototype.hasOwnProperty.call(models, model)) return model
  const alias = aliases[model]
  if (typeof alias === 'string' && Object.prototype.hasOwnProperty.call(models, alias)) return alias
  return null
}

/**
 * Cost in the configured currency for one request.
 * @param tokens - `{ inputTokens, cacheReadTokens, outputTokens }` for the request.
 * @param price - `{ cacheHit, cacheMiss, output }` per million tokens.
 * @param atMs - when the request was made, deciding the peak multiplier.
 * @param peakMultiplier - the peak-time multiplier.
 * @returns the request cost.
 */
export function requestCost(tokens, price, atMs, peakMultiplier) {
  const multiplier = isPeakTime(atMs) ? peakMultiplier : 1
  const input = Number(tokens.inputTokens) || 0
  const cached = Number(tokens.cacheReadTokens) || 0
  const output = Number(tokens.outputTokens) || 0
  return ((input * price.cacheMiss + cached * price.cacheHit + output * price.output) / 1_000_000) * multiplier
}

/** `deepseek-flash @ 2026-11-07T05:00Z` style label used by the tooltip. */
export function describeWindow(ms) {
  const { weekday, hour } = beijingClock(ms)
  return `${WEEKDAYS[weekday]} ${String(hour).padStart(2, '0')}:00 Beijing`
}
