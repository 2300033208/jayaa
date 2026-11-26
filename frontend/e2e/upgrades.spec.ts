import { expect, test } from '@playwright/test'
import { SMALL, createExperiment, expectNoInvalidNumbers, resetEngine, trackErrors } from './helpers'

test.beforeEach(async ({ request }) => {
  await resetEngine(request)
})

test('Monte Carlo studies: repeat, sweep and time-lapse run in the engine and report statistics', async ({ page, request }) => {
  test.setTimeout(240_000)
  const errors = trackErrors(page)
  const exp = await createExperiment(request, SMALL)
  await page.goto(`/experiments/${exp.id}/study`)
  await expect(page.getByText('No study yet.')).toBeVisible()

  // Repeat: detection rate with its interval, significance histogram, accuracy and coverage.
  await page.getByRole('textbox', { name: 'Runs', exact: true }).fill('6')
  await page.getByRole('button', { name: 'Start study' }).click()
  await expect(page.getByRole('heading', { name: 'Detection significance across runs' })).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText('Detection rate').first()).toBeVisible()
  await expect(page.getByText(/\d+\/6; 95 % interval/).first()).toBeVisible()
  await expect(page.getByRole('table').filter({ hasText: 'Truth inside 95 % interval' })).toBeVisible()

  // Sweep: a 2 × 2 grid.
  await page.getByRole('radio', { name: 'Mass × depth sweep' }).check()
  await page.getByRole('textbox', { name: 'Runs per cell', exact: true }).fill('5')
  await page.locator('#field-study-mass-count').fill('2')
  await page.locator('#field-study-depth-count').fill('2')
  await page.getByRole('button', { name: 'Start study' }).click()
  await expect(page.getByRole('heading', { name: 'Detection probability over mass and depth' })).toBeVisible({ timeout: 120_000 })

  // Time-lapse: a mass loss between two surveys.
  await page.getByRole('radio', { name: 'Time-lapse change' }).check()
  await page.getByRole('textbox', { name: 'Runs', exact: true }).fill('5')
  await page.getByRole('button', { name: 'Start study' }).click()
  await expect(page.getByText('Change detected').first()).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText(/without shared benchmarks/)).toBeVisible()

  // All three are listed, newest first, and reopen from the list.
  const history = page.getByRole('list', { name: 'Studies of this experiment' })
  await expect(history.getByRole('button')).toHaveCount(3)
  await history.getByRole('button', { name: /Repeat experiment/ }).click()
  await expect(page.getByRole('heading', { name: 'Detection significance across runs' })).toBeVisible()
  await expectNoInvalidNumbers(page)
  expect(errors).toEqual([])
})

test('invalid study settings are rejected with the engine reason', async ({ page, request }) => {
  const exp = await createExperiment(request, SMALL)
  await page.goto(`/experiments/${exp.id}/study`)
  await page.getByRole('radio', { name: 'Time-lapse change' }).check()
  await page.locator('#field-study-change').fill('-9e12') // would remove more than the 5 × 10¹² kg body
  await page.getByRole('button', { name: 'Start study' }).click()
  await expect(page.getByText('The change would remove or reverse the body; use a smaller change.').first()).toBeVisible()
})

test('survey design assistant recommends a design and applies it to the form', async ({ page, request }) => {
  const exp = await createExperiment(request, SMALL)
  await page.goto(`/experiments/${exp.id}`)
  await expect(page.getByText('Configuration validated by the engine')).toBeVisible()
  await page.locator('#field-design-days').fill('40')
  await page.getByRole('button', { name: 'Find a design' }).click()
  await expect(page.getByText(/^Reliable design found:|^No design within|^No design fits/)).toBeVisible({ timeout: 60_000 })
  const apply = page.getByRole('button', { name: 'Apply recommended design' })
  if (await apply.isVisible()) {
    const before = await page.getByRole('textbox', { name: 'Resolution (point spacing)', exact: true }).inputValue()
    await apply.click()
    await expect(page.getByText('Unsaved changes')).toBeVisible()
    const after = await page.getByRole('textbox', { name: 'Resolution (point spacing)', exact: true }).inputValue()
    expect(after).not.toBe(before)
  }
})

test('comparison shows differing settings and each campaign’s detection limit', async ({ page, request }) => {
  const a = await createExperiment(request, { ...SMALL, name: 'Field campaign' })
  const b = await createExperiment(request, { ...SMALL, name: 'Longer averaging', survey: { spacing_m: 1000 }, noise: { seed: 3 } })
  await page.goto('/compare')
  await page.getByLabel(new RegExp(a.code)).check()
  await page.getByLabel(new RegExp(b.code)).check()
  await page.getByRole('button', { name: /^Compare/ }).click()
  await expect(page).toHaveURL(new RegExp(`ids=${a.id}(%2C|,)${b.id}`))
  await expect(page.getByRole('heading', { name: 'What each campaign can detect' })).toBeVisible({ timeout: 60_000 })
  const settings = page.getByRole('table').filter({ hasText: 'Campaign settings' })
  await expect(settings.getByRole('link', { name: a.code })).toBeVisible()
  await expect(settings.getByRole('link', { name: b.code })).toBeVisible()
  await expectNoInvalidNumbers(page)
})

test('site physics settings are validated in the browser', async ({ page, request }) => {
  const exp = await createExperiment(request, SMALL)
  await page.goto(`/experiments/${exp.id}`)
  await expect(page.getByRole('radio', { name: 'Modelled' })).toBeChecked()
  await page.locator('#field-survey-start_date').fill('1999-06-01')
  await expect(page.getByText('Start date must be between 2000-01-01 and 2100-12-31.').first()).toBeVisible()
})
