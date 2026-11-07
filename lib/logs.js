/**
 * Session-log ingestion.
 *
 * DSH appends every session event to a log file under `$DSH_HOME/sessions`.
 * The `.zstd` variant is a multi-frame Zstandard container: each flush appends
 * one frame, so the reader decodes frame by frame from the last byte offset and
 * keeps a partially written frame for the next pass. Older sessions use a plain
 * `.jsonl` file, and a session directory may hold both a legacy log and a
 * versioned one — only the highest log version in a directory is read, which
 * keeps a migrated session from being counted twice.
 *
 * The only events that matter are `assistant/message`, whose `data.usage` is the
 * provider-reported token bill for one request.
 *
 * @module dsh-caption-balance/logs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

import { currentWindow, requestCost, resolvePriceKey } from './pricing.js'

/** Legacy log: `session.jsonl[.zstd]`; versioned: `session.v4.jsonl[.zstd]`. */
const LOG_NAME = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/

/** Refuse to parse absurd frames; a legit frame is a few KiB. */
const MAX_BUFFER_BYTES = 64 * 1024 * 1024

const hasZstd = typeof zlib.zstdDecompressSync === 'function'

/** Resolve the sessions directory, preferring an explicit configuration. */
export function sessionsRoot(configured) {
  if (typeof configured === 'string' && configured.length > 0) return path.resolve(configured)
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'sessions')
}

const pad = (value) => String(value).padStart(2, '0')

/** Local calendar day key, `YYYY-MM-DD`. */
export function dayKeyOf(ms) {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Local calendar month key, `YYYY-MM`. */
export function monthKeyOf(ms) {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

/** Zstandard frame magic, little endian. */
const ZSTD_MAGIC = 0xfd2fb528

/**
 * Walk the block headers of one frame and return the offset just past it, or
 * throw when the frame is not complete yet.
 */
function frameEnd(buffer, start) {
  let offset = start + 4
  if (offset + 1 > buffer.length) throw new Error('short frame header')
  const descriptor = buffer[offset]
  offset += 1
  const fcsFlag = descriptor >> 6
  const singleSegment = (descriptor >> 5) & 1
  const checksum = (descriptor >> 2) & 1
  const dictionaryFlag = descriptor & 3
  if (singleSegment === 0) offset += 1
  offset += [0, 1, 2, 4][dictionaryFlag]
  offset += singleSegment === 1 ? [1, 2, 4, 8][fcsFlag] : [0, 2, 4, 8][fcsFlag]
  // Block headers are 3 bytes: last(1) | type(2) | size(21).
  for (;;) {
    if (offset + 3 > buffer.length) throw new Error('short block header')
    const header = buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
    offset += 3
    const last = header & 1
    const type = (header >> 1) & 3
    const size = header >> 3
    if (type === 0) offset += size
    else if (type === 1) offset += 1
    else offset += size
    if (offset > buffer.length) throw new Error('short block')
    if (last === 1) break
  }
  if (checksum === 1) offset += 4
  if (offset > buffer.length) throw new Error('short checksum')
  return offset
}

/**
 * Decode every complete Zstandard frame in `buffer`, frame by frame.
 *
 * Frame boundaries are found from the container structure rather than by
 * feeding the decoder and inspecting how much it reported consuming: a torn
 * trailing frame can decode to a partial string while still reporting the whole
 * input as consumed, which would silently swallow the rest of the log.
 *
 * @returns `{ text, consumed }`, where `consumed` is the byte length of the
 *   complete frames — a partially written trailing frame is left unread.
 */
export function decodeFrames(buffer) {
  if (!hasZstd || buffer.length === 0) return { text: '', consumed: 0 }
  const chunks = []
  let offset = 0
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === ZSTD_MAGIC) {
    let end
    try {
      end = frameEnd(buffer, offset)
    } catch {
      break
    }
    try {
      chunks.push(zlib.zstdDecompressSync(buffer.subarray(offset, end)))
    } catch {
      break
    }
    offset = end
  }
  return { text: Buffer.concat(chunks).toString('utf8'), consumed: offset }
}

/** Pick the highest-version log file inside one session directory. */
export function pickLogFile(directory) {
  let best = null
  let names
  try {
    names = fs.readdirSync(directory)
  } catch {
    return null
  }
  for (const name of names) {
    const match = LOG_NAME.exec(name)
    if (match === null) continue
    const version = match[1] === undefined ? 0 : Number(match[1])
    const candidate = {
      file: path.join(directory, name),
      version,
      compressed: match[2] === '.zstd',
    }
    if (!hasZstd && candidate.compressed) continue
    if (best === null || candidate.version > best.version) best = candidate
  }
  return best
}

/**
 * Incremental reader for one log file.
 *
 * `read()` returns only events appended since the previous call. A shrinking
 * file means the log was rewritten, which the index reports so it can rebuild.
 */
export class LogTail {
  /** @param entry - `{ file, compressed }` from {@link pickLogFile}. */
  constructor(entry) {
    this.file = entry.file
    this.compressed = entry.compressed
    this.offset = 0
    this.pending = ''
  }

  /**
   * Read one batch of appended events.
   * @returns `{ events, rewritten }`.
   */
  read() {
    let stat
    try {
      stat = fs.statSync(this.file)
    } catch {
      return { events: [], rewritten: false }
    }
    const rewritten = stat.size < this.offset
    if (rewritten) {
      this.offset = 0
      this.pending = ''
    }
    if (stat.size === this.offset) return { events: [], rewritten: false }

    const length = Math.min(stat.size - this.offset, MAX_BUFFER_BYTES)
    const buffer = Buffer.alloc(length)
    let handle
    try {
      handle = fs.openSync(this.file, 'r')
      fs.readSync(handle, buffer, 0, length, this.offset)
    } catch {
      return { events: [], rewritten: false }
    } finally {
      if (handle !== undefined) fs.closeSync(handle)
    }

    let text
    let consumed
    if (this.compressed) {
      const decoded = decodeFrames(buffer)
      text = decoded.text
      consumed = decoded.consumed
    } else {
      text = buffer.toString('utf8')
      consumed = buffer.length
    }
    this.offset += consumed
    if (consumed === 0) return { events: [], rewritten }

    const lines = (this.pending + text).split('\n')
    this.pending = lines.pop() ?? ''
    const events = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      try {
        events.push(JSON.parse(trimmed))
      } catch {
        // A torn line is skipped; the next batch cannot repair it, and one
        // malformed event must not poison the whole index.
      }
    }
    return { events, rewritten }
  }
}

/** Empty accumulator for one day or one month. */
function createBucket(key) {
  return {
    key,
    sessions: new Set(),
    days: new Set(),
    requests: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cost: 0,
    firstMs: Number.POSITIVE_INFINITY,
    lastMs: 0,
    unpriced: new Set(),
    models: new Map(),
  }
}

const modelEntry = (bucket, model) => {
  let entry = bucket.models.get(model)
  if (entry === undefined) {
    entry = {
      model,
      requests: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cost: 0,
      priced: true,
    }
    bucket.models.set(model, entry)
  }
  return entry
}

const round = (value) => Math.round(value * 1e6) / 1e6

/** Project one bucket into the wire shape the client renders. */
export function bucketView(bucket, key) {
  const models = []
  for (const entry of bucket.models.values()) {
    models.push({
      model: entry.model,
      priced: entry.priced,
      requests: entry.requests,
      inputTokens: entry.inputTokens,
      cacheReadTokens: entry.cacheReadTokens,
      outputTokens: entry.outputTokens,
      reasoningTokens: entry.reasoningTokens,
      totalTokens: entry.inputTokens + entry.cacheReadTokens + entry.outputTokens,
      cost: round(entry.cost),
    })
  }
  models.sort((a, b) => b.totalTokens - a.totalTokens)
  return {
    key,
    requests: bucket.requests,
    sessions: bucket.sessions.size,
    days: bucket.days.size,
    inputTokens: bucket.inputTokens,
    cacheReadTokens: bucket.cacheReadTokens,
    outputTokens: bucket.outputTokens,
    reasoningTokens: bucket.reasoningTokens,
    totalTokens: bucket.inputTokens + bucket.cacheReadTokens + bucket.outputTokens,
    cost: round(bucket.cost),
    costComplete: bucket.unpriced.size === 0,
    unpricedModels: [...bucket.unpriced],
    firstMs: Number.isFinite(bucket.firstMs) ? bucket.firstMs : null,
    lastMs: bucket.lastMs > 0 ? bucket.lastMs : null,
    models,
  }
}

/**
 * The authoritative usage index: daily and monthly buckets rebuilt from the
 * session logs, refreshed incrementally as new events land.
 */
export class UsageIndex {
  constructor({ sessionsDir, keepDays, models, aliases, peakMultiplier, logger = null }) {
    this.root = sessionsDir
    this.keepDays = keepDays
    this.models = models
    this.aliases = aliases
    this.peakMultiplier = peakMultiplier
    this.logger = logger
    this.tails = new Map()
    this.daily = new Map()
    this.monthly = new Map()
    this.loaded = false
    this.files = 0
    this.events = 0
    this.errors = []
  }

  /** Absolute sessions directory in use. */
  get rootDir() {
    return this.root
  }

  /** Walk `sessions/<workspace>/<session>/<log>` and return session directories. */
  sessionDirectories() {
    const directories = []
    let workspaceEntries
    try {
      workspaceEntries = fs.readdirSync(this.root, { withFileTypes: true })
    } catch {
      return directories
    }
    for (const workspace of workspaceEntries) {
      if (!workspace.isDirectory()) continue
      const workspacePath = path.join(this.root, workspace.name)
      let sessions
      try {
        sessions = fs.readdirSync(workspacePath, { withFileTypes: true })
      } catch {
        continue
      }
      for (const session of sessions) {
        if (!session.isDirectory()) continue
        directories.push({ path: path.join(workspacePath, session.name), id: session.name })
      }
    }
    return directories
  }

  /** Full scan: used once on first read. */
  load() {
    if (this.loaded) return
    this.loaded = true
    this.rescan(true)
  }

  /** Drop all accumulators and tails; the next refresh rebuilds from disk. */
  reset() {
    this.tails.clear()
    this.daily.clear()
    this.monthly.clear()
    this.files = 0
    this.events = 0
  }

  /** Discover log files, keeping existing tails for files that are still there. */
  rescan(first = false) {
    const seen = new Set()
    for (const directory of this.sessionDirectories()) {
      const entry = pickLogFile(directory.path)
      if (entry === null) continue
      seen.add(entry.file)
      let tail = this.tails.get(entry.file)
      if (tail === undefined) {
        tail = new LogTail(entry)
        tail.sessionId = directory.id
        this.tails.set(entry.file, tail)
        this.files += 1
      }
      const { events, rewritten } = tail.read()
      if (rewritten && !first) {
        this.logger?.warn?.(`[dsh-caption-balance] log rewritten, rebuilding index: ${entry.file}`)
        this.reset()
        this.loaded = true
        this.rescan(true)
        return
      }
      this.ingest(events, tail.sessionId)
    }
    for (const file of [...this.tails.keys()]) {
      if (!seen.has(file)) this.tails.delete(file)
    }
  }

  /** Incremental refresh: pick up appended events and prune old buckets. */
  refresh(now = Date.now()) {
    if (!this.loaded) {
      this.load()
      return
    }
    this.rescan(false)
    this.prune(now)
  }

  /** Add one batch of parsed events to the buckets. */
  ingest(events, sessionId) {
    for (const event of events) {
      if (event === null || typeof event !== 'object') continue
      if (event.type !== 'assistant/message') continue
      const usage = event.data?.usage
      if (usage === null || typeof usage !== 'object') continue
      const at = Number(event.time)
      if (!Number.isFinite(at) || at <= 0) continue

      const model = String(
        event.data?.message?.source?.model
          ?? event.data?.message?.model
          ?? event.data?.model
          ?? 'unknown',
      )
      const tokens = {
        inputTokens: Number(usage.inputTokens) || 0,
        cacheReadTokens: Number(usage.cacheReadTokens) || 0,
        outputTokens: Number(usage.outputTokens) || 0,
        reasoningTokens: Number(usage.reasoningTokens) || 0,
      }
      const priceKey = resolvePriceKey(model, this.models, this.aliases)
      const price = priceKey === null ? null : this.models[priceKey]
      const cost = price === null ? 0 : requestCost(tokens, price, at, this.peakMultiplier)

      const dayKey = dayKeyOf(at)
      const monthKey = monthKeyOf(at)
      let day = this.daily.get(dayKey)
      if (day === undefined) {
        day = createBucket(dayKey)
        this.daily.set(dayKey, day)
      }
      let month = this.monthly.get(monthKey)
      if (month === undefined) {
        month = createBucket(monthKey)
        this.monthly.set(monthKey, month)
      }

      for (const bucket of [day, month]) {
        bucket.sessions.add(sessionId)
        bucket.days.add(dayKey)
        bucket.requests += 1
        bucket.inputTokens += tokens.inputTokens
        bucket.cacheReadTokens += tokens.cacheReadTokens
        bucket.outputTokens += tokens.outputTokens
        bucket.reasoningTokens += tokens.reasoningTokens
        bucket.cost += cost
        if (at < bucket.firstMs) bucket.firstMs = at
        if (at > bucket.lastMs) bucket.lastMs = at
        const entry = modelEntry(bucket, model)
        entry.requests += 1
        entry.inputTokens += tokens.inputTokens
        entry.cacheReadTokens += tokens.cacheReadTokens
        entry.outputTokens += tokens.outputTokens
        entry.reasoningTokens += tokens.reasoningTokens
        entry.cost += cost
        if (price === null) {
          entry.priced = false
          bucket.unpriced.add(model)
        }
      }
      this.events += 1
    }
  }

  /** Drop daily buckets past the retention window and stale months. */
  prune(now) {
    const cutoff = dayKeyOf(now - this.keepDays * 24 * 60 * 60 * 1000)
    for (const key of [...this.daily.keys()]) {
      if (key < cutoff) this.daily.delete(key)
    }
    const currentMonth = monthKeyOf(now)
    for (const key of [...this.monthly.keys()]) {
      if (key < currentMonth) this.monthly.delete(key)
    }
  }

  /** Today's and month-to-date views, plus the pricing window. */
  summary(now = Date.now()) {
    this.refresh(now)
    const dayKey = dayKeyOf(now)
    const monthKey = monthKeyOf(now)
    const today = this.daily.get(dayKey)
    const month = this.monthly.get(monthKey)
    const emptyDay = createBucket(dayKey)
    const emptyMonth = createBucket(monthKey)

    const monthStart = new Date(now)
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const retentionStart = now - this.keepDays * 24 * 60 * 60 * 1000

    return {
      today: bucketView(today ?? emptyDay, dayKey),
      month: {
        ...bucketView(month ?? emptyMonth, monthKey),
        complete: retentionStart <= monthStart.getTime(),
      },
      window: currentWindow(now),
    }
  }

  /** Aggregate file state for diagnostics. */
  stats() {
    return {
      sessionsDir: this.root,
      files: this.files,
      events: this.events,
      days: this.daily.size,
      errors: this.errors.slice(0, 5),
    }
  }
}
