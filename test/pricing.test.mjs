import test from 'node:test'
import assert from 'node:assert/strict'

import { currentWindow, isPeakTime, requestCost, resolvePriceKey } from '../lib/pricing.js'

/** Beijing wall clock (UTC+08:00) → epoch milliseconds. */
const beijing = (year, month, day, hour, minute = 0) =>
  Date.UTC(year, month - 1, day, hour, minute) - 8 * 60 * 60 * 1000

const price = { cacheHit: 0.02, cacheMiss: 1, output: 4 }

test('isPeakTime follows the Beijing weekday windows', () => {
  // 2026-11-09 is a Monday.
  assert.equal(isPeakTime(beijing(2026, 11, 9, 9, 0)), true)
  assert.equal(isPeakTime(beijing(2026, 11, 9, 11, 59)), true)
  assert.equal(isPeakTime(beijing(2026, 11, 9, 12, 0)), false)
  assert.equal(isPeakTime(beijing(2026, 11, 9, 13, 59)), false)
  assert.equal(isPeakTime(beijing(2026, 11, 9, 14, 0)), true)
  assert.equal(isPeakTime(beijing(2026, 11, 9, 17, 59)), true)
  assert.equal(isPeakTime(beijing(2026, 11, 9, 18, 0)), false)
  // Weekend is always off-peak.
  assert.equal(isPeakTime(beijing(2026, 11, 7, 10, 0)), false)
  assert.equal(isPeakTime(beijing(2026, 11, 8, 15, 0)), false)
})

test('currentWindow reports the phase and the next boundary', () => {
  const window = currentWindow(beijing(2026, 11, 9, 10, 30))
  assert.equal(window.phase, 'peak')
  assert.equal(window.changesAt, beijing(2026, 11, 9, 12, 0))
  assert.equal(window.nextPhase, 'offpeak')

  const evening = currentWindow(beijing(2026, 11, 9, 19, 0))
  assert.equal(evening.phase, 'offpeak')
  assert.equal(evening.changesAt, beijing(2026, 11, 10, 9, 0))
  assert.equal(evening.nextPhase, 'peak')
})

test('requestCost charges cache-hit, cache-miss and output at their own rates', () => {
  const offPeak = beijing(2026, 11, 9, 20, 0)
  const tokens = { inputTokens: 1000, cacheReadTokens: 1_000_000, outputTokens: 5000 }
  // (1000 * 1 + 1e6 * 0.02 + 5000 * 4) / 1e6 = 0.041
  assert.equal(Number(requestCost(tokens, price, offPeak, 2).toFixed(6)), 0.041)

  const peak = beijing(2026, 11, 9, 10, 0)
  assert.equal(Number(requestCost(tokens, price, peak, 2).toFixed(6)), 0.082)
})

test('resolvePriceKey prefers an exact model, then aliases, then nothing', () => {
  const models = { 'deepseek-flash': price }
  const aliases = { 'deepseek-v4-flash-vision-exp': 'deepseek-flash' }
  assert.equal(resolvePriceKey('deepseek-flash', models, aliases), 'deepseek-flash')
  assert.equal(resolvePriceKey('deepseek-v4-flash-vision-exp', models, aliases), 'deepseek-flash')
  assert.equal(resolvePriceKey('some-other-model', models, aliases), null)
  assert.equal(resolvePriceKey('', models, aliases), null)
})
