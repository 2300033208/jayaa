import { expect, test } from '@playwright/test'
import { SMALL, createExperiment, expectNoInvalidNumbers, resetEngine, trackErrors } from './helpers'

test.beforeEach(async ({ request }) => {
  await resetEngine(request)
})

test('clock vs gravimeter comparison is computed by the engine and follows the gravimeter choice', async ({ page, request }) => {
  const errors = trackErrors(page)
  const exp = await createExperiment(request, SMALL)
  await page.goto(`/experiments/${exp.id}`)
  const section = page.getByRole('region', { name: 'Clock, gravimeter or both?' })
  await section.scrollIntoViewIfNeeded()
  await expect(section.getByText('The gravimeter dominates:')).toBeVisible({ timeout: 60_000 })
  await expect(section.getByRole('rowheader', { name: 'Clock + gravimeter' })).toBeVisible()
  await expect(section.getByRole('heading', { name: 'How good must the clock be?' })).toBeVisible()

  await section.getByRole('radio', { name: 'Absolute gravimeter' }).check()
  await expect(section.getByText(/and the absolute gravimeter \(/)).toBeVisible({ timeout: 60_000 })
  await expectNoInvalidNumbers(page)
  expect(errors).toEqual([])
})

test('validation page recomputes the published benchmarks', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/validation')
  await expect(page.getByText(/^(\d+) of \1 checks agree$/)).toBeVisible()
  await expect(page.getByRole('heading', { name: /Tokyo Skytree/ })).toBeVisible()
  await expect(page.getByText('Disagrees')).toHaveCount(0)
  await expectNoInvalidNumbers(page)
  expect(errors).toEqual([])
})
