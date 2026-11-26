import { expect, test } from '@playwright/test'
import { ENGINE, SMALL, createExperiment, expectNoInvalidNumbers, listSimulations, measurementCount, resetEngine, trackErrors } from './helpers'

test.beforeEach(async ({ request }) => {
  await resetEngine(request)
})

test('empty engine: every page explains what to do', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByText('No experiments yet.')).toBeVisible()
  await page.goto('/history')
  await expect(page.getByText('No experiments yet.')).toBeVisible()
  await page.goto('/simulation')
  await expect(page.getByText('No experiment selected.')).toBeVisible()

  const exp = await createExperiment(request, SMALL)
  await page.goto(`/experiments/${exp.id}/analysis`)
  await expect(page.getByText('No simulation has been run for this experiment.')).toBeVisible()
  await page.goto(`/experiments/${exp.id}/simulation`)
  await expect(page.getByText('Start the simulation to begin measuring.')).toBeVisible()
  await expect(page.getByText('No measurements available yet.')).toBeVisible()
  await expectNoInvalidNumbers(page)
})

test('invalid input is rejected in the browser and never reaches the engine', async ({ page }) => {
  const posts: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname.endsWith("/api/experiments")) posts.push(r.url())
  })
  await page.goto('/experiments/new')
  await expect(page.getByText('Configuration validated by the engine')).toBeVisible()
  const depth = page.getByRole('textbox', { name: 'Depth to centre', exact: true })
  await depth.fill('-5')
  await expect(page.getByText('Depth must be greater than 0 m.').first()).toBeVisible()
  await page.getByRole('textbox', { name: 'Density contrast', exact: true }).fill('0')
  await expect(page.getByText('Density contrast must be greater than 0 kg/m³.').first()).toBeVisible()
  await page.getByRole('textbox', { name: 'Resolution (point spacing)', exact: true }).fill('abc')
  await expect(page.getByText('Resolution must be a finite number.').first()).toBeVisible()
  await expect(page.getByText(/3 issues to fix/)).toBeVisible()
  // Run jumps to the first invalid field in document order (Density contrast precedes Depth in the form).
  await page.getByRole('button', { name: 'Run simulation' }).click()
  await expect(page.getByRole('textbox', { name: 'Density contrast', exact: true })).toBeFocused()
  expect(posts).toEqual([])
})

test('engine unavailable: honest error, no fake data', async ({ page }) => {
  // Only engine API calls (path root /api/), not the app's own /src/api/* modules.
  await page.route(/^https?:\/\/[^/]+\/api\//, (route) => route.abort('connectionrefused'))
  await page.goto('/')
  // The session cannot be checked without the engine, so the page offers a retry instead of the app shell.
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.getByText('Simulation engine unavailable').first()).toBeVisible()
  await expect(page.getByText('Check the backend connection and try again.').first()).toBeVisible()
  await expect(page.getByText(/All systems operational/)).toHaveCount(0)
  await page.goto('/experiments/new')
  await expect(page.getByText('Simulation engine unavailable').first()).toBeVisible()
  await expect(page.locator('.js-plotly-plot')).toHaveCount(0)
})

test('malformed REST responses are rejected with a precise message', async ({ page }) => {
  await page.route('**/api/experiments?limit=5', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[{"id":1,"name":null}]}' }))
  await page.goto('/')
  await expect(page.getByText(/unexpected response/)).toBeVisible()
  await page.route('**/api/experiments?limit=200', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"items": NaN}' }))
  await page.goto('/history')
  await expect(page.getByText('The simulation engine returned a response that is not valid JSON.')).toBeVisible()
})

test('WebSocket disconnect: reconnects and resumes without duplicate measurements', async ({ page, request }) => {
  const errors = trackErrors(page)
  const exp = await createExperiment(request, SMALL)
  await page.goto(`/experiments/${exp.id}/simulation`)
  await page.getByRole('button', { name: 'Start simulation' }).click()
  await expect.poll(() => measurementCount(page), { timeout: 30_000 }).toBeGreaterThan(5)
  const sims = await listSimulations(request, exp.id)
  const simId = String(sims[0]?.id)

  const reconnect = page.waitForEvent('websocket', (ws) => ws.url().includes('/stream') && !ws.url().includes('after_index=-1'))
  const drop = await request.post(`${ENGINE}/api/_test/simulations/${simId}/drop-connections`)
  expect(drop.ok()).toBe(true)
  const ws = await reconnect
  expect(Number(new URL(ws.url()).searchParams.get('after_index'))).toBeGreaterThan(4)
  await expect(page.getByText('Live stream connected')).toBeVisible()

  await expect(page.getByRole('link', { name: 'Open full analysis' })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText('81 / 81')).toBeVisible()
  await expect(page.getByText('All received')).toBeVisible()
  expect(errors).toEqual([])
})

test('malformed and unknown WebSocket messages are rejected safely', async ({ page, request }) => {
  const exp = await createExperiment(request, SMALL)
  await page.goto(`/experiments/${exp.id}/simulation`)
  await page.getByRole('button', { name: 'Start simulation' }).click()
  await expect.poll(() => measurementCount(page), { timeout: 30_000 }).toBeGreaterThan(3)
  const simId = String((await listSimulations(request, exp.id))[0]?.id)
  for (const raw of ['{not json', '{"type":"from_the_future","simulation_id":"x","seq":1}', `{"type":"simulation_progress","simulation_id":"${simId}","seq":99999,"progress":"NaN"}`]) {
    await request.post(`${ENGINE}/api/_test/simulations/${simId}/inject`, { data: { raw } })
  }
  await expect(page.getByText('Invalid engine messages rejected')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open full analysis' })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText('81 / 81')).toBeVisible()
  await expectNoInvalidNumbers(page)
})

test('simulation failure shows the engine reason and allows retry', async ({ page, request }) => {
  const exp = await createExperiment(request, SMALL)
  await request.post(`${ENGINE}/api/_test/fail-next-simulation`, { data: { phase: 'performing_inversion' } })
  await page.goto(`/experiments/${exp.id}/simulation`)
  await page.getByLabel('Playback speed').selectOption({ label: 'Instant' })
  await page.getByRole('button', { name: 'Start simulation' }).click()
  await expect(page.getByRole('heading', { name: 'Simulation failed' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('RuntimeError: Injected failure (test hook)')).toBeVisible()
  await expect(page.getByText('Failed', { exact: true })).toBeVisible()
  await expect(page.getByText('Stopped during: Performing inversion.')).toBeVisible()

  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('link', { name: 'Open full analysis' })).toBeVisible({ timeout: 90_000 })
  await page.goto(`/experiments/${exp.id}/analysis?simulation=${String((await listSimulations(request, exp.id)).at(-1)?.id)}`)
  await expect(page.getByText('This simulation failed')).toBeVisible()
  await expect(page.getByText('RuntimeError: Injected failure (test hook)')).toBeVisible()
})

test('cancellation stops the run and labels partial data', async ({ page, request }) => {
  const exp = await createExperiment(request, SMALL)
  await page.goto(`/experiments/${exp.id}/simulation`)
  await page.getByRole('button', { name: 'Start simulation' }).click()
  await expect.poll(() => measurementCount(page), { timeout: 30_000 }).toBeGreaterThan(3)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible()
  await expect(page.getByText(/Partial simulation: \d+ of 81 measurements were recorded/)).toBeVisible()
  const count = await measurementCount(page)
  await page.waitForTimeout(1500)
  expect(await measurementCount(page)).toBe(count)
  await page.goto(`/experiments/${exp.id}/analysis`)
  await expect(page.getByText('This simulation was cancelled.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Export partial CSV' })).toBeVisible()
})

test('duplicate start requests create exactly one simulation', async ({ page, request }) => {
  const exp = await createExperiment(request, SMALL)
  await page.goto(`/experiments/${exp.id}/simulation`)
  const start = page.getByRole('button', { name: 'Start simulation' })
  await start.dblclick()
  await expect(page.getByText('Running', { exact: true })).toBeVisible()
  await page.waitForTimeout(500)
  expect(await listSimulations(request, exp.id)).toHaveLength(1)

  // A second tab cannot start a parallel run either: it attaches to the active one.
  const other = await page.context().newPage()
  await other.goto(`/experiments/${exp.id}/simulation`)
  await expect(other.getByText('Running', { exact: true })).toBeVisible()
  await expect(other.getByRole('button', { name: 'Start simulation' })).toHaveCount(0)
  expect(await listSimulations(request, exp.id)).toHaveLength(1)
  await other.close()
})
