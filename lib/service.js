/**
 * Host-side data service: account balance plus today/month usage.
 *
 * Balance is read through the official account service (`deepseekAccount`), the
 * same call the shipped settings page makes, so the plugin never sees a
 * credential and never calls the platform API directly. It is cached because
 * the platform is an external service and the widget polls.
 *
 * @module dsh-caption-balance/service
 */
import { VERSION } from './config.js'
import { UsageIndex, sessionsRoot } from './logs.js'

const round = (value) => Math.round(value * 1e6) / 1e6

/**
 * Settle with `promise`, or reject once `ms` elapses.
 *
 * A balance request that never settles would otherwise hold the coalesced
 * promise forever, so every later poll would await the same stuck call.
 *
 * @param promise - the operation to bound.
 * @param ms - deadline in milliseconds.
 * @returns the operation's result, or a rejection naming the deadline.
 */
export function withTimeout(promise, ms) {
  let timer = null
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`balance query timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, deadline]).finally(() => {
    if (timer !== null) clearTimeout(timer)
  })
}

/** Read an optional Cordis service without declaring it as a dependency. */
function optionalService(ctx, name) {
  try {
    const service = ctx?.get?.(name)
    return service === undefined || service === null ? null : service
  } catch {
    return null
  }
}

const timezoneOffsetSeconds = () => -new Date().getTimezoneOffset() * 60

/**
 * Build the plugin's data service.
 * @param options - Cordis context, normalized config and logger.
 * @returns the summary reader plus its cache state.
 */
export function createService({ ctx, config, logger = null }) {
  const index = new UsageIndex({
    sessionsDir: sessionsRoot(config.sessionsDir),
    keepDays: config.keepDays,
    models: config.models,
    aliases: config.aliases,
    peakMultiplier: config.peakMultiplier,
    logger,
  })

  let balance = { at: 0, value: null, pending: null }

  /** Read the account balance, coalescing concurrent reads and caching it. */
  async function readBalance(force = false) {
    const age = Date.now() - balance.at
    if (!force && balance.value !== null && age < config.balanceRefreshSeconds * 1000) {
      return { ...balance.value, cached: true, fetchedAt: balance.at }
    }
    if (balance.pending !== null) return balance.pending

    balance.pending = (async () => {
      const account = optionalService(ctx, 'deepseekAccount')
      if (account === null || typeof account.getBalance !== 'function') {
        return { status: 'unavailable' }
      }
      try {
        const result = await withTimeout(
          account.getBalance({
            version: VERSION,
            locale: config.currency === 'CNY' ? 'zh' : 'en',
            timezoneOffsetSeconds: timezoneOffsetSeconds(),
          }),
          config.balanceTimeoutMs,
        )
        if (result === null || result === undefined) return { status: 'signed-out' }
        if (result.status === 'failed') return { status: 'failed' }
        if (result.status === 'ready') {
          return {
            status: 'ready',
            wallets: Array.isArray(result.value) ? result.value : [],
            bonusWallets: Array.isArray(result.bonusWallets) ? result.bonusWallets : [],
          }
        }
        return { status: 'failed', error: `unexpected balance status: ${String(result.status)}` }
      } catch (error) {
        const message = error?.message ?? String(error)
        logger?.warn?.(`[dsh-caption-balance] balance query failed: ${message}`)
        return { status: 'failed', error: message }
      }
    })()

    let value
    try {
      value = await balance.pending
    } finally {
      balance.pending = null
    }
    balance = { at: Date.now(), value, pending: null }
    return { ...value, cached: false, fetchedAt: balance.at }
  }

  /**
   * Compose one summary payload for the client.
   * @param options - `force` bypasses the balance cache.
   * @returns the JSON-serializable summary.
   */
  async function summary({ force = false } = {}) {
    const now = Date.now()
    let usage
    try {
      usage = index.summary(now)
    } catch (error) {
      logger?.warn?.(`[dsh-caption-balance] usage index failed: ${error?.message ?? error}`)
      usage = null
    }
    const balanceView = await readBalance(force)

    return {
      ok: true,
      version: VERSION,
      updatedAt: now,
      hostNow: now,
      timezoneOffsetSeconds: timezoneOffsetSeconds(),
      dayKey: usage?.today?.key ?? null,
      monthKey: usage?.month?.key ?? null,
      window: usage?.window ?? null,
      today: usage?.today ?? null,
      month: usage?.month ?? null,
      balance: balanceView,
      pricing: {
        currency: config.currency,
        peakMultiplier: config.peakMultiplier,
        refreshSeconds: config.refreshSeconds,
        balanceRefreshSeconds: config.balanceRefreshSeconds,
        keepDays: config.keepDays,
      },
      display: config.display,
      diagnostics: index.stats(),
    }
  }

  return { summary, readBalance, index, config }
}

/** Re-exported so tests can check the rounding rule without a full service. */
export const roundCost = round
