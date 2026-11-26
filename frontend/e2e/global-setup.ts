import { request } from '@playwright/test'
import { AUTH_STATE, CSRF_HEADERS, ENGINE, TEST_ACCOUNT } from './helpers'

/**
 * Signs in once (registering the account on a fresh engine) and saves the session cookie. Every test's
 * page and API request context reuse it; the reset hook keeps accounts, so the session survives resets.
 */
export default async function globalSetup(): Promise<void> {
  const context = await request.newContext({ extraHTTPHeaders: CSRF_HEADERS })
  const register = await context.post(`${ENGINE}/api/auth/register`, { data: TEST_ACCOUNT })
  if (register.status() !== 201) {
    const login = await context.post(`${ENGINE}/api/auth/login`, { data: { email: TEST_ACCOUNT.email, password: TEST_ACCOUNT.password } })
    if (!login.ok()) throw new Error(`could not sign in the e2e account: ${String(login.status())} ${await login.text()}`)
  }
  await context.storageState({ path: AUTH_STATE })
  await context.dispose()
}
