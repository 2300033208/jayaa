import { expect, test } from '@playwright/test'
import { ENGINE, SMALL, TEST_SCENARIO_TITLE, createExperiment, expectNoInvalidNumbers, listSimulations, measurementCount, resetEngine, selectPlayback, trackErrors } from './helpers'

test.beforeEach(async ({ request }) => {
  await resetEngine(request)
})

test('complete workflow: create → validate → simulate → analyse → reload → identical results', async ({ page, request }) => {
  const errors = trackErrors(page)
  await page.goto('/')
  await expect(page.getByText('No experiments yet.')).toBeVisible()
  await page.getByRole('link', { name: 'New experiment' }).first().click()

  // Start from a research scenario, then enter valid parameters.
  await expect(page.getByText('Configuration validated by the engine')).toBeVisible()
  await page.getByLabel('Start from').selectOption({ label: TEST_SCENARIO_TITLE })
  await expect(page.getByText(/^Expected outcome: Clearly detected/)).toBeVisible()
  await page.locator('#field-name').fill('E2E deep ore body')
  await page.getByRole('textbox', { name: 'Resolution (point spacing)', exact: true }).fill('1000')
  await page.getByRole('textbox', { name: 'Bootstrap samples', exact: true }).fill('40')
  await expect(page.getByText('9 × 9 = 81 measurement points.')).toBeVisible()
  await expect(page.getByText('Configuration validated by the engine')).toBeVisible()

  // The engine's detectability study answers "could this campaign detect the body?" before running.
  await expect(page.getByRole('heading', { name: 'Detectability study' })).toBeVisible()
  await expect(page.getByText('Detectable:')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Expected detection significance' })).toBeVisible()

  // Submit → engine validation → start.
  await page.getByRole('button', { name: 'Run simulation' }).click()
  await expect(page).toHaveURL(/\/experiments\/[0-9a-f]{32}\/simulation$/)
  const experimentId = /experiments\/([0-9a-f]{32})/.exec(page.url())?.[1] ?? ''
  await expect(page.getByText('Running', { exact: true })).toBeVisible()
  await expect(page.getByText('Live stream connected')).toBeVisible()

  // Sensor animation and 3D scene are live; graph and counters update from streamed data.
  await expect(page.getByRole('img', { name: /3D view of the survey area/ })).toBeVisible()
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect.poll(() => measurementCount(page), { timeout: 30_000 }).toBeGreaterThan(5)
  const early = await measurementCount(page)
  await expect.poll(() => measurementCount(page), { timeout: 30_000 }).toBeGreaterThan(early)
  await expect(page.getByText('Running survey…')).toBeVisible()

  // Completion reveal.
  await expect(page.getByRole('link', { name: 'Open full analysis' })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText('81 / 81')).toBeVisible()
  await expect(page.getByText('All received')).toBeVisible()
  await expectNoInvalidNumbers(page)

  // Analysis: map, reconstruction, uncertainty, ground truth.
  await page.getByRole('link', { name: 'Open full analysis' }).click()
  for (const heading of ['3D reconstruction', 'Gravity anomaly map', 'Frequency shift', 'Signal and noise', 'Ground truth vs estimation', 'Error metrics', 'Uncertainty']) {
    await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible()
  }
  await expect(page.getByRole('img', { name: /3D reconstruction with 1 estimated sources/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Estimated depth · 95 % interval/ })).toBeVisible()
  await expect(page.getByText('Pairs are formed by optimal assignment')).toBeVisible()

  // Inspect a map cell (after every section has loaded, so the layout no longer shifts).
  await expect(page.getByRole('heading', { name: 'Depth distribution' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Noise budget vs signal' })).toBeVisible()
  const map = page.getByRole('figure', { name: /Gravity anomaly · forward model \(ground truth\) over a 9 by 9 grid/ })
  await map.scrollIntoViewIfNeeded()
  const size = await map.boundingBox()
  if (size === null) throw new Error('map not laid out')
  const position = { x: size.width * 0.45, y: size.height * 0.45 }
  await map.hover({ position })
  await expect(page.locator('.hoverlayer .hovertext').first()).toBeVisible()
  await map.click({ position })
  const inspector = page.getByRole('complementary', { name: 'Selected point' })
  await expect(inspector.getByText('Measurement index')).toBeVisible()
  await expect(inspector.getByText('Frequency shift Δf/f₀ (normal field removed)')).toBeVisible()

  // Displayed estimate matches the engine's stored result exactly.
  const sims = await listSimulations(request, experimentId)
  expect(sims).toHaveLength(1)
  const simId = String(sims[0]?.id)
  const results = (await (await request.get(`${ENGINE}/api/simulations/${simId}/results`)).json()) as { summary: { primary_source: { depth_m: number } } }
  const summary = page.locator('section[aria-labelledby="results-title"]')
  const before = await summary.innerText()
  expect(before).toContain(`${Math.round(results.summary.primary_source.depth_m)}`.slice(0, 3))

  // Reload → identical results.
  await page.reload()
  await expect(page.locator('section[aria-labelledby="results-title"]')).toBeVisible()
  expect(await page.locator('section[aria-labelledby="results-title"]').innerText()).toBe(before)
  await expectNoInvalidNumbers(page)
  expect(errors).toEqual([])
})

test('browser refresh during a run re-attaches without duplicating the simulation or data', async ({ page, request }) => {
  const errors = trackErrors(page)
  const exp = await createExperiment(request, SMALL)
  await page.goto(`/experiments/${exp.id}/simulation`)
  await page.getByRole('button', { name: 'Start simulation' }).click()
  await expect.poll(() => measurementCount(page), { timeout: 30_000 }).toBeGreaterThan(8)

  // Pause so the run is still active after the (slow, dev-server) reload.
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByText('Paused', { exact: true })).toBeVisible()
  const before = await measurementCount(page)

  const stream = page.waitForEvent('websocket', (ws) => ws.url().includes('/stream'))
  await page.reload()
  const ws = await stream
  // Already-held measurements are restored over REST; the stream resumes after the last one.
  expect(Number(new URL(ws.url()).searchParams.get('after_index'))).toBe(before - 1)
  await expect(page.getByText('Paused', { exact: true })).toBeVisible()
  await expect(page.getByText('Live stream connected')).toBeVisible()
  expect(await measurementCount(page)).toBe(before)

  await page.getByRole('button', { name: 'Resume' }).click()
  await expect(page.getByText('Running', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open full analysis' })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText('81 / 81')).toBeVisible()
  await expect(page.getByText('All received')).toBeVisible()

  const sims = await listSimulations(request, exp.id)
  expect(sims).toHaveLength(1)
  const measurements = (await (await request.get(`${ENGINE}/api/simulations/${String(sims[0]?.id)}/measurements`)).json()) as { columns: { index: number[] } }
  expect(measurements.columns.index).toEqual(Array.from({ length: 81 }, (_, i) => i))
  expect(errors).toEqual([])
})

test('changing the configuration marks the previous result out of date', async ({ page, request }) => {
  const exp = await createExperiment(request, SMALL)
  await page.goto(`/experiments/${exp.id}/simulation`)
  await selectPlayback(page, 'Instant')
  await page.getByRole('button', { name: 'Start simulation' }).click()
  await expect(page.getByRole('link', { name: 'Open full analysis' })).toBeVisible({ timeout: 90_000 })

  await page.goto(`/experiments/${exp.id}`)
  await expect(page.getByText(/Saved · version 1/)).toBeVisible()
  await page.getByRole('textbox', { name: 'Depth to centre', exact: true }).fill('1600')
  await expect(page.getByText('Previous result will be out of date')).toBeVisible()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText(/Saved · version 2/)).toBeVisible()

  await page.goto(`/experiments/${exp.id}/analysis`)
  await expect(page.getByText('Result out of date')).toBeVisible()
  await expect(page.getByText(/configuration version 1\. The experiment has changed since \(now version 2\)/)).toBeVisible()
})
