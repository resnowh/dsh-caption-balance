/**
 * User preferences for the display block, persisted outside the profile patch.
 *
 * The profile's `cordis.patch.yml` keeps the deployment defaults; the settings
 * page writes overrides here so a user can flip the switches at runtime without
 * editing YAML. Missing or corrupt files fall back to the deployment defaults.
 *
 * @module dsh-caption-balance/preferences
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Absolute path of the persisted preference file. */
export function preferencesFile() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'plugin-data', 'dsh-caption-balance', 'settings.json')
}

/**
 * Read saved display overrides.
 * @param file - preference file, defaulting to {@link preferencesFile}.
 * @returns the saved display overrides, or `{}` when none are readable.
 */
export function readPreferences(file = preferencesFile()) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return {}
  }
  try {
    const parsed = JSON.parse(raw)
    const display = parsed?.display
    return display !== null && typeof display === 'object' ? display : {}
  } catch {
    return {}
  }
}

/**
 * Persist display overrides.
 * @param display - the validated display block to store.
 * @param file - preference file, defaulting to {@link preferencesFile}.
 */
export function writePreferences(display, file = preferencesFile()) {
  const directory = path.dirname(file)
  fs.mkdirSync(directory, { recursive: true })
  const temporary = `${file}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify({ display }, null, 2)}\n`, 'utf8')
  // Rename keeps readers from observing a half-written file.
  fs.renameSync(temporary, file)
}
