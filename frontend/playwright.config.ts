import { defineConfig, devices } from '@playwright/test'
import { AUTH_STATE, CSRF_HEADERS } from './e2e/helpers'

const ENGINE_PORT = 8765
const preview = process.env.E2E_PREVIEW === '1'
const APP_PORT = preview ? 4173 : 5173

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    storageState: AUTH_STATE,
    extraHTTPHeaders: CSRF_HEADERS,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: 'node e2e/start-engine.mjs',
      url: `http://127.0.0.1:${ENGINE_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { E2E_ENGINE_PORT: String(ENGINE_PORT) },
    },
    {
      command: preview ? `npx vite preview --port ${APP_PORT} --strictPort` : `npx vite --port ${APP_PORT} --strictPort`,
      url: `http://127.0.0.1:${APP_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ENGINE_URL: `http://127.0.0.1:${ENGINE_PORT}` },
    },
  ],
})
