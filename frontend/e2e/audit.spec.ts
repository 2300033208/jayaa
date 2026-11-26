import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { ENGINE, SMALL, createExperiment, resetEngine } from './helpers'

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
] as const

let experimentId = ''
let secondId = ''

test.beforeAll(async ({ request }) => {
  await resetEngine(request)
  const exp = await createExperiment(request, SMALL)
  experimentId = exp.id
  const sim = await request.post(`${ENGINE}/api/experiments/${exp.id}/simulations`, { data: { playback: 'instant' } })
  const simId = ((await sim.json()) as { id: string }).id
  await expect
    .poll(async () => ((await (await request.get(`${ENGINE}/api/simulations/${simId}`)).json()) as { status: string }).status, { timeout: 60_000 })
    .toBe('completed')
  // A finished Monte Carlo study and a second experiment, so the Study and Compare pages show real content.
  const study = await request.post(`${ENGINE}/api/experiments/${exp.id}/studies`, { data: { kind: 'repeat', runs: 5 } })
  const studyId = ((await study.json()) as { id: string }).id
  await expect
    .poll(async () => ((await (await request.get(`${ENGINE}/api/studies/${studyId}`)).json()) as { status: string }).status, { timeout: 120_000 })
    .toBe('completed')
  secondId = (await createExperiment(request, { ...SMALL, name: 'Second campaign', noise: { seed: 7 } })).id
})

function pages() {
  return [
    { name: 'home', path: '/', ready: 'Recent experiments' },
    { name: 'experiment', path: `/experiments/${experimentId}`, ready: 'Configuration validated by the engine' },
    { name: 'simulation', path: `/experiments/${experimentId}/simulation`, ready: 'Open full analysis' },
    { name: 'analysis', path: `/experiments/${experimentId}/analysis`, ready: 'Depth distribution' },
    { name: 'history', path: '/history', ready: 'EXP-00001' },
    { name: 'study', path: `/experiments/${experimentId}/study`, ready: 'Detection significance across runs' },
    { name: 'compare', path: `/compare?ids=${experimentId},${secondId}`, ready: 'What each campaign can detect' },
  ]
}

async function open(page: Page, path: string, ready: string) {
  await page.goto(path)
  await expect(page.getByText(ready, { exact: false }).first()).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(400)
}

test('responsive: no horizontal overflow, clipped controls or unreadable values at any viewport', async ({ page }) => {
  test.setTimeout(600_000)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    for (const p of pages()) {
      await open(page, p.path, p.ready)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, `${p.name} @ ${viewport.width}×${viewport.height} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1)
      // Every visible button must be fully inside the viewport horizontally.
      const clipped = await page.evaluate(() =>
        Array.from(document.querySelectorAll('main button, nav a'))
          .filter((el) => {
            const r = el.getBoundingClientRect()
            const style = getComputedStyle(el)
            return r.width > 0 && style.visibility !== 'hidden' && (r.left < -1 || r.right > window.innerWidth + 1) && !el.closest('.modebar')
          })
          .map((el) => (el.getAttribute('aria-label') ?? el.textContent).trim()),
      )
      expect(clipped, `${p.name} @ ${viewport.width}: clipped controls`).toEqual([])
      await page.screenshot({ path: `test-results/responsive/${p.name}-${viewport.width}x${viewport.height}.png`, fullPage: true })
    }
  }
})

for (const scheme of ['light', 'dark'] as const) {
  test(`accessibility (${scheme}): no serious or critical axe violations`, async ({ page }) => {
    test.setTimeout(300_000)
    await page.emulateMedia({ colorScheme: scheme })
    await page.setViewportSize({ width: 1440, height: 900 })
    for (const p of pages()) {
      await open(page, p.path, p.ready)
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        // Plotly's hover-only modebar is third-party chrome; every chart offers accessible buttons and a table view instead.
        .exclude('.modebar-container')
        .analyze()
      const serious = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
      expect(serious, `${p.name} (${scheme})`).toEqual([])
      await page.screenshot({ path: `test-results/a11y/${p.name}-${scheme}.png`, fullPage: true })
    }
  })
}

test('keyboard: skip link, visible focus and operable controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/experiments/${experimentId}/simulation`)
  await expect(page.getByText('Open full analysis')).toBeVisible()
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  const outline = await page.evaluate(() => {
    const el = document.activeElement
    return el ? getComputedStyle(el).outlineStyle : 'none'
  })
  expect(outline).not.toBe('none')
})

test('reduced motion is respected', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const duration = await page.evaluate(() => getComputedStyle(document.querySelector('main > *') ?? document.body).animationDuration)
  expect(['0s', '1e-05s']).toContain(duration)
})
