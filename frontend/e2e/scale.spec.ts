import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { createExperiment, expectNoInvalidNumbers, resetEngine, selectPlayback, trackErrors } from './helpers'

test.beforeEach(async ({ request }) => {
  await resetEngine(request)
})

/** Longest gap (ms) between main-thread ticks while `until` is pending: a frozen UI shows large gaps. */
async function watchMainThread(page: Page, until: Promise<unknown>): Promise<number> {
  await page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __stop: boolean }
    w.__gaps = []
    w.__stop = false
    let last = performance.now()
    const tick = () => {
      const now = performance.now()
      w.__gaps.push(now - last)
      last = now
      if (!w.__stop) setTimeout(tick, 50)
    }
    tick()
  })
  await until
  return page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __stop: boolean }
    w.__stop = true
    return Math.max(...w.__gaps)
  })
}

async function runAndMeasure(page: Page, experimentId: string, points: string, timeout: number) {
  const errors = trackErrors(page)
  await page.goto(`/experiments/${experimentId}/simulation`)
  await selectPlayback(page, 'Instant')
  // Measure streaming, not page start-up: let the 3D scene and chart library finish loading first.
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
  const started = Date.now()
  await page.getByRole('button', { name: 'Start simulation' }).click()
  const done = expect(page.getByRole('link', { name: 'Open full analysis' })).toBeVisible({ timeout })
  const worstGap = await watchMainThread(page, done)
  const seconds = (Date.now() - started) / 1000
  await expect(page.getByText(`${points} / ${points}`)).toBeVisible()
  await expect(page.getByText('All received')).toBeVisible()
  await expectNoInvalidNumbers(page)
  expect(errors).toEqual([])
  return { seconds, worstGap }
}

test('10 000 measurements stream, render and analyse without freezing the UI', async ({ page, request }) => {
  test.setTimeout(300_000)
  const exp = await createExperiment(request, { survey: { width_m: 8000, length_m: 8000, spacing_m: 80 }, inversion: { bootstrap_samples: 40 } })
  const { seconds, worstGap } = await runAndMeasure(page, exp.id, '10 201', 240_000)
  test.info().annotations.push({ type: 'perf', description: `10 201 points: ${seconds.toFixed(1)} s end-to-end, worst main-thread gap ${worstGap.toFixed(0)} ms` })
  expect(worstGap).toBeLessThan(1000)

  await page.getByRole('link', { name: 'Open full analysis' }).click()
  await expect(page.getByRole('heading', { name: 'Uncertainty', exact: true })).toBeVisible()
  await expect(page.getByRole('figure', { name: /Fractional frequency shift \(Δf\/f₀\) for 10201 measurements/ })).toBeVisible()
  await page.getByRole('button', { name: 'Table' }).first().click()
  await expect(page.getByText('Rows 1–25 of 10201')).toBeVisible()
})

test('100 000 measurements: rendering is reduced for display, data is preserved', async ({ page, request }) => {
  test.skip(process.env.E2E_LARGE !== '1', 'Set E2E_LARGE=1 to run the 100 000-point performance test')
  test.setTimeout(900_000)
  const exp = await createExperiment(request, { survey: { width_m: 31500, length_m: 31500, spacing_m: 100 }, inversion: { bootstrap_samples: 20 } })
  const { seconds, worstGap } = await runAndMeasure(page, exp.id, '99 856', 840_000)
  test.info().annotations.push({ type: 'perf', description: `99 856 points: ${seconds.toFixed(1)} s end-to-end, worst main-thread gap ${worstGap.toFixed(0)} ms` })
  expect(worstGap).toBeLessThan(3000)
  await expect(page.getByText(/Rendering 20,000 of 99,856 points/)).toBeVisible()
  await expect(page.getByText('The table view and exports contain every measurement.')).toBeVisible()
})
