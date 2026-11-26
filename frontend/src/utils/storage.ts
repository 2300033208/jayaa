/*
 * Versioned, validated localStorage for per-browser preferences only (theme, last opened
 * experiment, chart choices). Nothing scientific and no credentials are stored here.
 * Corrupted, outdated or expired entries are discarded instead of crashing the app.
 */

const PREFIX = 'ags:'
const SCHEMA_VERSION = 1

interface Envelope {
  v: number
  savedAt: number
  value: unknown
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readStored<T>(key: string, validate: (value: unknown) => value is T, maxAgeMs?: number): T | null {
  const store = storage()
  if (!store) return null
  let raw: string | null
  try {
    raw = store.getItem(PREFIX + key)
  } catch {
    return null
  }
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) throw new Error('corrupt')
    const envelope = parsed as Partial<Envelope>
    if (envelope.v !== SCHEMA_VERSION || typeof envelope.savedAt !== 'number') throw new Error('schema')
    if (maxAgeMs !== undefined && Date.now() - envelope.savedAt > maxAgeMs) throw new Error('expired')
    if (!validate(envelope.value)) throw new Error('invalid')
    return envelope.value
  } catch {
    removeStored(key)
    return null
  }
}

export function writeStored(key: string, value: unknown): void {
  const store = storage()
  if (!store) return
  try {
    const envelope: Envelope = { v: SCHEMA_VERSION, savedAt: Date.now(), value }
    store.setItem(PREFIX + key, JSON.stringify(envelope))
  } catch {
    // Quota exceeded or storage disabled: preferences are optional.
  }
}

export function removeStored(key: string): void {
  try {
    storage()?.removeItem(PREFIX + key)
  } catch {
    // ignore
  }
}

export const isExperimentId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)

export function oneOf<T extends string>(values: readonly T[]) {
  return (value: unknown): value is T => typeof value === 'string' && (values as readonly string[]).includes(value)
}
