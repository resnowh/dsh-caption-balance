/**
 * Host half of dsh-caption-balance.
 *
 * It owns exactly one HTTP route that the browser half polls, and nothing else:
 * no session events are appended, no other plugin's registrations are touched,
 * and no model-visible content is added.
 *
 * @module dsh-caption-balance
 */
import { normalizeConfig } from './lib/config.js'
import { createService } from './lib/service.js'

export const name = 'dsh-caption-balance'

/**
 * The one service this half needs. Cordis only hands a plugin a service its
 * fiber may see, so without this the route registration can run before the web
 * server exists and the widget would be dead on a cold start.
 */
export const inject = ['webServer']

/** Exact path served to the browser half. */
export const ROUTE = '/api/dsh-caption-balance/summary'

/** Hostname part of a `Host` / `Origin` authority, without the port. */
function authorityHostname(authority) {
  const value = String(authority ?? '')
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end > 0 ? value.slice(1, end).toLowerCase() : ''
  }
  const colon = value.lastIndexOf(':')
  return (colon > 0 ? value.slice(0, colon) : value).toLowerCase()
}

function isLoopbackName(hostname) {
  if (hostname === 'localhost' || hostname === '::1') return true
  if (hostname.endsWith('.localhost')) return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
}

/**
 * The route is registered as an exact path, so it wins over the API gateway's
 * `/api` prefix and does not inherit that layer's browser session check. It
 * carries account data, so the same loopback-only trust rules are applied here
 * before anything is answered.
 */
function isTrustedCaller(req, extraHosts) {
  const host = req.headers?.host
  if (typeof host !== 'string' || host.length === 0) return false
  const hostname = authorityHostname(host)
  if (!isLoopbackName(hostname) && !extraHosts.includes(hostname)) return false

  const origin = req.headers?.origin
  if (typeof origin === 'string' && origin.length > 0) {
    let originAuthority
    try {
      originAuthority = new URL(origin).host
    } catch {
      return false
    }
    if (originAuthority.toLowerCase() !== host.toLowerCase()) return false
  }
  return String(req.headers?.['sec-fetch-site'] ?? '').toLowerCase() !== 'cross-site'
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Mount the host half.
 * @param ctx - the plugin's Cordis context.
 * @param config - the bundle row's config.
 */
export function apply(ctx, config) {
  const settings = normalizeConfig(config)
  const logger = ctx?.logger ?? null
  const service = createService({ ctx, config: settings, logger })

  // Warm the usage index in the background so the first client poll does not
  // pay for the full history scan.
  setTimeout(() => {
    try {
      service.index.load()
      const stats = service.index.stats()
      logger?.info?.(
        `[dsh-caption-balance] watching ${stats.sessionsDir} (${stats.files} logs, ${stats.events} billed requests)`,
      )
    } catch (error) {
      logger?.warn?.(`[dsh-caption-balance] first scan failed: ${error?.message ?? error}`)
    }
  }, 0)

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (webServer === null || webServer === undefined || typeof webServer.register !== 'function') {
      // Unreachable while `inject` holds. If it is ever reached the widget is
      // dead, so report it instead of degrading silently.
      logger?.error?.('[dsh-caption-balance] webServer.register unavailable; the summary route was NOT registered')
      return () => {}
    }
    return webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { allow: 'GET, HEAD' })
          res.end()
          return
        }
        if (!isTrustedCaller(req, settings.allowHosts ?? [])) {
          sendJson(res, 403, { ok: false, error: 'untrusted request' })
          return
        }
        try {
          const url = new URL(req.url ?? '/', 'http://dsh.internal')
          const payload = await service.summary({ force: url.searchParams.get('force') === '1' })
          sendJson(res, 200, payload)
        } catch (error) {
          logger?.warn?.(`[dsh-caption-balance] summary failed: ${error?.message ?? error}`)
          sendJson(res, 500, { ok: false, error: error?.message ?? String(error) })
        }
      },
    })
  }, 'dsh-caption-balance: summary route')
}
