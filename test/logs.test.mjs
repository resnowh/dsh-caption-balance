import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

import { LogTail, UsageIndex, bucketView, decodeFrames, dayKeyOf, pickLogFile, sessionsRoot } from '../lib/logs.js'

const zstd = (text) => zlib.zstdCompressSync(Buffer.from(text, 'utf8'))

/** Create a fresh temporary directory for one test. */
function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-caption-balance-'))
}

const event = (time, model, usage) => ({
  type: 'assistant/message',
  time,
  data: { message: { role: 'assistant', source: { kind: 'model', model } }, usage },
})

test('decodeFrames reads every complete frame and stops at a torn one', () => {
  const first = zstd('{"a":1}\n')
  const second = zstd('{"b":2}\n{"c":3}\n')
  const decoded = decodeFrames(Buffer.concat([first, second]))
  assert.equal(decoded.text, '{"a":1}\n{"b":2}\n{"c":3}\n')
  assert.equal(decoded.consumed, first.length + second.length)

  // A trailing partial frame is not decoded and is not counted as consumed.
  const torn = Buffer.concat([first, second.subarray(0, second.length - 3)])
  const partial = decodeFrames(torn)
  assert.equal(partial.text, '{"a":1}\n')
  assert.equal(partial.consumed, first.length)
})

test('pickLogFile prefers the highest log version in a session directory', () => {
  const directory = tempDir()
  fs.writeFileSync(path.join(directory, 'session.jsonl.zstd'), zstd(''))
  fs.writeFileSync(path.join(directory, 'session.v4.jsonl.zstd'), zstd(''))
  const picked = pickLogFile(directory)
  assert.equal(path.basename(picked.file), 'session.v4.jsonl.zstd')
  assert.equal(picked.version, 4)
})

test('LogTail returns only appended events and buffers a half-written frame', () => {
  const directory = tempDir()
  const file = path.join(directory, 'session.jsonl.zstd')
  const first = zstd('{"type":"turn/start"}\n')
  fs.writeFileSync(file, first)
  const tail = new LogTail({ file, compressed: true })
  assert.deepEqual(tail.read().events, [{ type: 'turn/start' }])

  const second = zstd('{"type":"assistant/message"}\n')
  fs.appendFileSync(file, second.subarray(0, second.length - 2))
  assert.deepEqual(tail.read().events, [])

  fs.appendFileSync(file, second.subarray(second.length - 2))
  assert.deepEqual(tail.read().events, [{ type: 'assistant/message' }])
})

test('UsageIndex aggregates only billed assistant messages', () => {
  const directory = tempDir()
  const models = { 'deepseek-flash': { cacheHit: 0.02, cacheMiss: 1, output: 4 } }
  const index = new UsageIndex({
    sessionsDir: directory,
    keepDays: 45,
    models,
    aliases: { 'deepseek-v4-flash': 'deepseek-flash' },
    peakMultiplier: 2,
  })
  const at = Date.now() - 60_000
  index.ingest([
    event(at, 'deepseek-v4-flash', { inputTokens: 1000, cacheReadTokens: 2_000_000, outputTokens: 500 }),
    // Non-billed events are ignored.
    { type: 'turn/start', time: at, data: {} },
    { type: 'assistant/message', time: at, data: { message: { source: { model: 'x' } } } },
  ], 'session-a')

  const view = bucketView(index.daily.get(dayKeyOf(at)), dayKeyOf(at))
  assert.equal(view.requests, 1)
  assert.equal(view.sessions, 1)
  assert.equal(view.inputTokens, 1000)
  assert.equal(view.cacheReadTokens, 2_000_000)
  assert.equal(view.outputTokens, 500)
  assert.equal(view.totalTokens, 2_001_500)
  assert.equal(view.costComplete, true)
  // 1000 * 1 + 2e6 * 0.02 + 500 * 4 = 43,000 → 0.043 per 1e6 tokens.
  assert.equal(Number(view.cost.toFixed(6)), 0.043)
  assert.equal(index.monthly.size, 1)
})

test('Unpriced models still count tokens but are flagged', () => {
  const directory = tempDir()
  const index = new UsageIndex({
    sessionsDir: directory,
    keepDays: 45,
    models: { 'deepseek-flash': { cacheHit: 0.02, cacheMiss: 1, output: 4 } },
    aliases: {},
    peakMultiplier: 2,
  })
  const at = Date.now() - 60_000
  index.ingest([event(at, 'mystery-model', { inputTokens: 10, outputTokens: 5 })], 'session-b')
  const view = bucketView(index.daily.get(dayKeyOf(at)), dayKeyOf(at))
  assert.equal(view.totalTokens, 15)
  assert.equal(view.cost, 0)
  assert.equal(view.costComplete, false)
  assert.deepEqual(view.unpricedModels, ['mystery-model'])
})

test('sessionsRoot prefers the configured directory', () => {
  assert.equal(sessionsRoot('C:/tmp/logs'), path.resolve('C:/tmp/logs'))
  assert.equal(sessionsRoot(null).endsWith(path.join('.dsh', 'sessions')), true)
})
