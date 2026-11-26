import type { FieldMessage } from '../types/api'
import { backoffDelay, sleep } from '../utils/time'
import { ApiError, ENGINE_UNAVAILABLE, messageForStatus, toApiError } from './errors'
import type { Parser } from './parse'
import { ParseError, isRecord } from './parse'
import { reportSessionLost } from './session'

const DEFAULT_TIMEOUT_MS = 20_000

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export interface RequestOptions {
  method?: HttpMethod
  body?: unknown
  /** Multipart upload (files); mutually exclusive with body. */
  form?: FormData
  signal?: AbortSignal
  timeoutMs?: number
  idempotencyKey?: string
  /** Extra attempts for transient failures. Defaults: GET 2, idempotent POST 1, otherwise 0. */
  retries?: number
}

function apiBase(): string {
  const configured: unknown = import.meta.env.VITE_API_BASE
  if (typeof configured === 'string' && configured !== '') {
    if (/^https?:\/\/[^\s]+$/.test(configured) || /^\/[^\s]*$/.test(configured)) return configured.replace(/\/$/, '')
    throw new Error('VITE_API_BASE must be an http(s) URL or a root-relative path')
  }
  return ''
}

export function apiUrl(path: string): string {
  if (!path.startsWith('/api/')) throw new Error(`API paths must start with /api/: ${path}`)
  return `${apiBase()}${path}`
}

export function wsUrl(path: string): string {
  const url = new URL(apiUrl(path), window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function containsNonFinite(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isFinite(value)
  if (Array.isArray(value)) return value.some(containsNonFinite)
  if (isRecord(value)) return Object.values(value).some(containsNonFinite)
  return false
}

function isFieldMessage(value: unknown): value is FieldMessage {
  return isRecord(value) && typeof value.field === 'string' && typeof value.message === 'string'
}

function httpError(status: number, payload: unknown): ApiError {
  const envelope = isRecord(payload) && isRecord(payload.error) ? payload.error : null
  if (envelope === null && status >= 500) {
    // Engine errors always carry a JSON envelope; a bare 5xx comes from a proxy that cannot reach it.
    return new ApiError('network', ENGINE_UNAVAILABLE, { status, code: 'engine_unreachable' })
  }
  const code = typeof envelope?.code === 'string' ? envelope.code : `http_${status}`
  const message = typeof envelope?.message === 'string' ? envelope.message : null
  const rawFields = envelope?.fields
  const fields = Array.isArray(rawFields) ? rawFields.filter(isFieldMessage) : []
  const details: Record<string, unknown> = {}
  if (envelope) {
    for (const [key, value] of Object.entries(envelope)) {
      if (!['code', 'message', 'fields'].includes(key)) details[key] = value
    }
  }
  return new ApiError('http', messageForStatus(status, message), { status, code, fields, details })
}

async function attempt<T>(path: string, parse: Parser<T>, options: RequestOptions, method: HttpMethod): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const timer = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const external = options.signal
  const onAbort = () => {
    controller.abort()
  }
  external?.addEventListener('abort', onAbort, { once: true })
  if (external?.aborted) controller.abort()

  const aborted = () =>
    timedOut
      ? new ApiError('timeout', 'The simulation engine did not respond in time.', { code: 'timeout' })
      : new ApiError('aborted', 'Request cancelled.', { code: 'aborted' })

  try {
    // The engine refuses state changes without this header: a page on another site cannot add it.
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    let body: string | FormData | undefined
    if (options.form !== undefined) {
      body = options.form // the browser sets the multipart boundary
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

    let response: Response
    try {
      response = await fetch(apiUrl(path), { method, headers, body, signal: controller.signal, credentials: 'include' })
    } catch {
      if (controller.signal.aborted) throw aborted()
      throw new ApiError('network', ENGINE_UNAVAILABLE, { code: 'network' })
    }

    let text: string
    try {
      text = await response.text()
    } catch {
      if (controller.signal.aborted) throw aborted()
      throw new ApiError('network', ENGINE_UNAVAILABLE, { code: 'network' })
    }

    let payload: unknown = null
    if (text !== '') {
      try {
        payload = JSON.parse(text) as unknown
      } catch {
        if (!response.ok) throw httpError(response.status, null)
        throw new ApiError('parse', 'The simulation engine returned a response that is not valid JSON.', {
          status: response.status,
          code: 'invalid_json',
        })
      }
    }
    if (!response.ok) {
      const error = httpError(response.status, payload)
      if (response.status === 401 && !path.startsWith('/api/auth/')) reportSessionLost(error.code)
      throw error
    }
    try {
      return parse(payload, 'response')
    } catch (error) {
      if (error instanceof ParseError) {
        throw new ApiError('parse', `The simulation engine returned an unexpected response (${error.message}).`, {
          status: response.status,
          code: 'invalid_response',
        })
      }
      throw error
    }
  } finally {
    globalThis.clearTimeout(timer)
    external?.removeEventListener('abort', onAbort)
  }
}

export async function request<T>(path: string, parse: Parser<T>, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  if (containsNonFinite(options.body)) {
    throw new ApiError('parse', 'Refusing to send a non-finite number to the simulation engine.', {
      code: 'invalid_request_data',
    })
  }
  const retries = options.retries ?? (method === 'GET' ? 2 : options.idempotencyKey ? 1 : 0)
  for (let n = 0; ; n += 1) {
    try {
      return await attempt(path, parse, options, method)
    } catch (error) {
      const err = toApiError(error)
      if (err.kind === 'aborted' || !err.retryable || n >= retries) throw err
      try {
        await sleep(backoffDelay(n, 400, 4000), options.signal)
      } catch {
        throw new ApiError('aborted', 'Request cancelled.', { code: 'aborted' })
      }
    }
  }
}

/** Parser for endpoints that return no body (HTTP 204). */
export const noContent: Parser<null> = () => null
