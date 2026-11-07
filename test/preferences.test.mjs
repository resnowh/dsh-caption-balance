import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { DISPLAY_DEFAULTS, normalizeDisplay } from '../lib/config.js'
import { preferencesFile, readPreferences, writePreferences } from '../lib/preferences.js'

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-caption-balance-prefs-'))

test('preferences round-trip through an atomic file write', () => {
  const file = path.join(tempDir(), 'nested', 'settings.json')
  writePreferences({ position: 'sidebar', showToday: false }, file)
  assert.deepEqual(readPreferences(file), { position: 'sidebar', showToday: false })
  assert.equal(fs.existsSync(`${file}.tmp`), false)
})

test('missing and corrupt preference files fall back to no overrides', () => {
  const directory = tempDir()
  assert.deepEqual(readPreferences(path.join(directory, 'missing.json')), {})
  const corrupt = path.join(directory, 'corrupt.json')
  fs.writeFileSync(corrupt, '{ not json', 'utf8')
  assert.deepEqual(readPreferences(corrupt), {})
  fs.writeFileSync(corrupt, JSON.stringify({ display: 42 }), 'utf8')
  assert.deepEqual(readPreferences(corrupt), {})
})

test('saved overrides win over the deployment defaults', () => {
  const file = path.join(tempDir(), 'settings.json')
  writePreferences({ position: 'header', showPhase: false }, file)
  const effective = normalizeDisplay({ ...DISPLAY_DEFAULTS, ...readPreferences(file) })
  assert.equal(effective.position, 'header')
  assert.equal(effective.showPhase, false)
  // Untouched fields keep the deployment default.
  assert.equal(effective.showBalance, true)
  assert.equal(effective.lowBalanceThreshold, DISPLAY_DEFAULTS.lowBalanceThreshold)
})

test('preferencesFile honours DSH_HOME', () => {
  const previous = process.env.DSH_HOME
  const home = tempDir()
  process.env.DSH_HOME = home
  try {
    assert.equal(preferencesFile(), path.join(home, 'plugin-data', 'dsh-caption-balance', 'settings.json'))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})
