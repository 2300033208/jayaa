import type { AuthConfig, User } from '../types/field'
import { noContent, request } from './client'
import { parseAuthConfig, parseUserEnvelope } from './fieldSchemas'

export function getAuthConfig(signal?: AbortSignal): Promise<AuthConfig> {
  return request('/api/auth/config', parseAuthConfig, { signal })
}

/** The signed-in user; rejects with HTTP 401 when there is no valid session. */
export function getCurrentUser(signal?: AbortSignal): Promise<User> {
  return request('/api/auth/me', parseUserEnvelope, { signal, retries: 1 })
}

export function signIn(email: string, password: string, signal?: AbortSignal): Promise<User> {
  return request('/api/auth/login', parseUserEnvelope, { method: 'POST', body: { email, password }, signal })
}

export function register(email: string, displayName: string, password: string, signal?: AbortSignal): Promise<User> {
  return request('/api/auth/register', parseUserEnvelope, {
    method: 'POST',
    body: { email, display_name: displayName, password },
    signal,
  })
}

export function signOut(): Promise<null> {
  return request('/api/auth/logout', noContent, { method: 'POST' })
}

export function changePassword(currentPassword: string, newPassword: string): Promise<null> {
  return request('/api/auth/password', noContent, {
    method: 'POST',
    body: { current_password: currentPassword, new_password: newPassword },
  })
}
