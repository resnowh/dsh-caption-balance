/**
 * Host half of dsh-caption-balance.
 *
 * It owns two exact HTTP routes used by the browser half — the usage summary
 * and the user-facing display settings — and nothing else: no session events are
 * appended, no other plugin's registrations are touched, and no model-visible
 * content is added.
 *
 * @module dsh-caption-balance
 */
import { normalizeConfig, normalizeDisplay } from './lib/config.js'
import { createService } from './lib/service.js'

export const name = 'dsh-caption-balance'

/**
 * The one service this half needs. Cordis only hands a plugin a service its
 * fiber may see, so without this the route registration can run before the web
 * server exists and the widget would be dead on a cold start.
 */
export const inject = ['webServer']

/** Exact path served to the browser half for the summary. */
export const ROUTE = '/api/dsh-caption-balance/summary'

/** Exact path for reading and writing the display preferences. */
export const SETTINGS_ROUTE = '/api/dsh-caption-balance/settings'

/** Header the settings page must send, which plain HTML forms cannot set. */
export const SETTINGS_HEADER = 'x-dsh-caption-balance'

/** Largest settings body accepted, in bytes. */
const MAX_BODY_BYTES = 16 * 1024

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
 * The routes are registered as exact paths, so they win over the API gateway's
 * `/api` prefix and do not inherit that layer's browser session check. They
 * carry account data, so the same loopback-only trust rules are applied here
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

/** Read a bounded JSON request body. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/** Mount one exact route and return its disposer. */
function registerRoute(webServer, path, handler) {
  return webServer.register({ kind: 'exact', path, handler })
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
      logger?.error?.('[dsh-caption-balance] webServer.register unavailable; the routes were NOT registered')
      return () => {}
    }

    const summaryRoute = registerRoute(webServer, ROUTE, async (req, res) => {
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
    })

    const settingsRoute = registerRoute(webServer, SETTINGS_ROUTE, async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.writeHead(405, { allow: 'GET, POST' })
        res.end()
        return
      }
      if (!isTrustedCaller(req, settings.allowHosts ?? [])) {
        sendJson(res, 403, { ok: false, error: 'untrusted request' })
        return
      }
      if (req.method === 'GET') {
        sendJson(res, 200, { ok: true, ...service.getSettings() })
        return
      }
      // A custom header forces a preflight for cross-origin callers and cannot
      // be set by a plain HTML form, so this blocks CSRF beyond the origin check.
      if (req.headers?.[SETTINGS_HEADER] !== '1') {
        sendJson(res, 403, { ok: false, error: 'missing settings header' })
        return
      }
      try {
        const body = await readJsonBody(req)
        const display = normalizeDisplay(body?.display)
        const result = service.updateSettings(display)
        sendJson(res, 200, { ok: true, ...result })
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error?.message ?? String(error) })
      }
    })

    return () => {
      summaryRoute?.()
      settingsRoute?.()
    }
  }, 'dsh-caption-balance: routes')
}
