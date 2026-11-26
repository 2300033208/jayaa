import type { APIRequestContext, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ENGINE = 'http://127.0.0.1:8765'

const here = dirname(fileURLToPath(import.meta.url))

/** Every state-changing request must carry this header (the engine's CSRF defence). */
export const CSRF_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' }
/** Session cookie saved by the global setup and reused by every test. */
export const AUTH_STATE = resolve(here, '../test-results/e2e-auth.json')
export const TEST_ACCOUNT = { email: 'e2e@example.org', display_name: 'E2E researcher', password: 'correct horse battery staple' }
type Json = Record<string, unknown>

/** Tests build on a fixed research scenario (not the product default, which may change). */
export const TEST_SCENARIO_TITLE = 'Mineral ore body · projected clocks'
const scenarios = JSON.parse(readFileSync(resolve(here, '../../contract/scenarios.json'), 'utf-8')) as {
  scenarios: { id: string; title: string; config: Json }[]
}
const testScenario = scenarios.scenarios.find((s) => s.title === TEST_SCENARIO_TITLE)
if (testScenario === undefined) throw new Error(`scenario "${TEST_SCENARIO_TITLE}" is missing from the contract`)
const defaults = testScenario.config

export function config(patch: { name?: string; survey?: Json; inversion?: Json; noise?: Json } = {}): Json {
  const base = structuredClone(defaults)
  return {
    ...base,
    name: patch.name ?? 'E2E experiment',
    survey: { ...(base.survey as Json), ...(patch.survey ?? {}) },
    inversion: { ...(base.inversion as Json), ...(patch.inversion ?? {}) },
    noise: { ...(base.noise as Json), ...(patch.noise ?? {}) },
  }
}

/** A small, fast configuration: 9 × 9 points, 20 bootstrap samples. */
export const SMALL = { survey: { spacing_m: 1000 }, inversion: { bootstrap_samples: 20 } }

export async function resetEngine(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${ENGINE}/api/_test/reset`)
  expect(res.ok()).toBe(true)
}

export async function createExperiment(request: APIRequestContext, patch: Parameters<typeof config>[0] = SMALL): Promise<{ id: string; code: string }> {
  const res = await request.post(`${ENGINE}/api/experiments`, { data: { config: config(patch) } })
  expect(res.status()).toBe(201)
  return (await res.json()) as { id: string; code: string }
}

export async function listSimulations(request: APIRequestContext, experimentId: string): Promise<Json[]> {
  const res = await request.get(`${ENGINE}/api/experiments/${experimentId}/simulations`)
  return ((await res.json()) as { items: Json[] }).items
}

/** Reads "N / M" from the live measurement counter. */
export async function measurementCount(page: Page): Promise<number> {
  const text = await page.getByRole('group', { name: 'Live measurement summary' }).innerText()
  const match = /([\d\u2009 ]+)\s*\/\s*([\d\u2009 ]+)/.exec(text)
  return match?.[1] ? Number(match[1].replace(/[\s\u2009]/g, '')) : 0
}

export async function selectPlayback(page: Page, playback: 'Normal playback' | 'Fast playback' | 'Instant'): Promise<void> {
  await page.getByLabel('Playback speed').selectOption({ label: playback })
}

/** Collects page errors and console errors for later assertions. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  return errors
}

export async function expectNoInvalidNumbers(page: Page): Promise<void> {
  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(/\bNaN\b|\bInfinity\b|\bundefined\b|\bnull\b/)
}
