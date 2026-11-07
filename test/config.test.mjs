import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULTS, VERSION, normalizeConfig, normalizeDisplay } from '../lib/config.js'
import pkg from '../package.json' with { type: 'json' }

test('normalizeConfig applies defaults for an empty row', () => {
  const config = normalizeConfig(undefined)
  assert.equal(config.currency, DEFAULTS.currency)
  assert.equal(config.refreshSeconds, DEFAULTS.refreshSeconds)
  assert.equal(config.peakMultiplier, DEFAULTS.peakMultiplier)
  assert.deepEqual(config.allowHosts, [])
  assert.deepEqual(Object.keys(config.models).sort(), ['deepseek-flash', 'deepseek-v4-pro'])
})

test('normalizeConfig clamps unsafe values instead of trusting them', () => {
  const config = normalizeConfig({
    refreshSeconds: 1,
    keepDays: 0,
    balanceTimeoutMs: 10,
    peakMultiplier: 0,
    sessionsDir: '  ',
    allowHosts: ['dsh.example.com', 42, ''],
    models: { 'my-model': { cacheHit: -1, cacheMiss: '2', output: 3 } },
    aliases: { 'alias-model': 'my-model', broken: 7 },
  })
  assert.equal(config.refreshSeconds, 5)
  assert.equal(config.keepDays, 2)
  assert.equal(config.balanceTimeoutMs, 1000)
  assert.equal(config.peakMultiplier, 0.1)
  assert.equal(config.sessionsDir, null)
  assert.deepEqual(config.allowHosts, ['dsh.example.com'])
  assert.deepEqual(config.models['my-model'], { cacheHit: 0, cacheMiss: 2, output: 3 })
  assert.deepEqual(config.aliases, { 'alias-model': 'my-model' })
  assert.equal(Object.isFrozen(config), true)
})

test('VERSION matches the package version', () => {
  assert.equal(VERSION, pkg.version)
})
test('display defaults keep every segment visible', () => {
  const display = normalizeConfig(undefined).display
  assert.deepEqual({ ...display }, {
    position: 'auto',
    showBalance: true,
    showToday: true,
    showPhase: true,
    smallDecimals: true,
    lowBalanceThreshold: 10,
    lowBalanceStyle: 'warn',
  })
})

test('display rejects unknown positions and styles, and keeps one segment', () => {
  const display = normalizeDisplay({
    position: 'somewhere',
    lowBalanceStyle: 'purple',
    lowBalanceThreshold: -5,
    showBalance: false,
    showToday: false,
    showPhase: false,
  })
  assert.equal(display.position, 'auto')
  assert.equal(display.lowBalanceStyle, 'warn')
  assert.equal(display.lowBalanceThreshold, 0)
  // Nothing selected would render an empty widget, so the balance comes back.
  assert.equal(display.showBalance, true)
  assert.equal(display.showToday, false)
  assert.equal(display.showPhase, false)
})

test('display accepts the supported positions', () => {
  for (const position of ['auto', 'caption', 'header', 'sidebar']) {
    assert.equal(normalizeDisplay({ position }).position, position)
  }
  assert.equal(normalizeDisplay({ lowBalanceStyle: 'danger' }).lowBalanceStyle, 'danger')
  assert.equal(normalizeDisplay({ showToday: false }).showToday, false)
})
