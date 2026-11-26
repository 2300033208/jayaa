import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from './client'
import { ApiError, ENGINE_UNAVAILABLE } from './errors'
import { object, string } from './parse'

const parser = object({ ok: string })

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function mockFetch(...responses: (Response | Error)[]) {
  const fn = vi.fn(() => {
    const next = responses.shift()
    if (next === undefined) throw new Error('unexpected extra request')
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('expected a failure')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('API client', () => {
  it('returns parsed data', async () => {
    mockFetch(json(200, { ok: 'yes' }))
    await expect(request('/api/health', parser)).resolves.toEqual({ ok: 'yes' })
  })

  it.each([
    [400, 'Bad value.', 'Bad value.'],
    [401, null, 'Your session has expired or you are not signed in. Sign in again to continue.'],
    [403, null, 'You do not have permission to perform this action.'],
    [404, 'Experiment not found.', 'Experiment not found.'],
    [409, 'A simulation is already running for this experiment.', 'A simulation is already running for this experiment.'],
    [422, 'The configuration is invalid.', 'The configuration is invalid.'],
    [429, null, 'Too many requests. Wait a moment and try again.'],
    [500, 'Engine error (ValueError).', 'The simulation engine reported an internal error: Engine error (ValueError).'],
  ])('maps HTTP %i to a precise message', async (status, engineMessage, expected) => {
    const body = engineMessage === null ? {} : { error: { code: 'x', message: engineMessage, fields: [] } }
    mockFetch(json(status, body))
    const err = await failure(request('/api/x', parser, { method: 'POST', body: {} }))
    expect(err.status).toBe(status)
    expect(err.message).toBe(expected)
  })

  it('carries field errors from 422 responses', async () => {
    mockFetch(json(422, { error: { code: 'invalid_configuration', message: 'The configuration is invalid.', fields: [{ field: 'bodies.0.depth_m', message: 'Depth must be greater than 0 m.' }, { junk: true }] } }))
    const err = await failure(request('/api/experiments', parser, { method: 'POST', body: {} }))
    expect(err.fields).toEqual([{ field: 'bodies.0.depth_m', message: 'Depth must be greater than 0 m.' }])
  })

  it.each([502, 503, 504])('reports HTTP %i as engine unavailable', async (status) => {
    mockFetch(json(status, {}), json(status, {}), json(status, {}))
    vi.useFakeTimers()
    const pending = failure(request('/api/x', parser))
    await vi.runAllTimersAsync()
    const err = await pending
    expect(err.engineUnavailable).toBe(true)
    expect(err.message).toBe(ENGINE_UNAVAILABLE)
  })

  it('treats a bare 5xx (proxy, no engine envelope) as unreachable engine', async () => {
    mockFetch(new Response('', { status: 500 }))
    const err = await failure(request('/api/x', parser, { method: 'POST' }))
    expect(err.engineUnavailable).toBe(true)
  })

  it('reports network failure without inventing data', async () => {
    mockFetch(new TypeError('Failed to fetch'))
    const err = await failure(request('/api/x', parser, { method: 'POST' }))
    expect(err.kind).toBe('network')
    expect(err.message).toBe(ENGINE_UNAVAILABLE)
  })

  it('retries idempotent GETs with backoff, but never 400/422', async () => {
    vi.useFakeTimers()
    const fetch = mockFetch(json(503, {}), json(200, { ok: 'yes' }))
    const pending = request('/api/x', parser)
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toEqual({ ok: 'yes' })
    expect(fetch).toHaveBeenCalledTimes(2)

    const fetch422 = mockFetch(json(422, { error: { code: 'x', message: 'bad', fields: [] } }))
    await failure(request('/api/x', parser))
    expect(fetch422).toHaveBeenCalledTimes(1)
  })

  it('does not retry a non-idempotent POST', async () => {
    const fetch = mockFetch(json(503, {}))
    await failure(request('/api/experiments', parser, { method: 'POST', body: {} }))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('sends the idempotency key and retries once for keyed requests', async () => {
    vi.useFakeTimers()
    const fetch = mockFetch(new TypeError('Failed to fetch'), json(201, { ok: 'yes' }))
    const pending = request('/api/experiments/x/simulations', parser, { method: 'POST', body: {}, idempotencyKey: 'key-12345' })
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toEqual({ ok: 'yes' })
    const init = fetch.mock.calls.at(-1) as unknown as [string, RequestInit]
    expect((init[1].headers as Record<string, string>)['Idempotency-Key']).toBe('key-12345')
  })

  it('times out slow requests', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'))
            })
          }),
      ),
    )
    const pending = failure(request('/api/x', parser, { method: 'POST', timeoutMs: 1000 }))
    await vi.advanceTimersByTimeAsync(1001)
    expect((await pending).kind).toBe('timeout')
  })

  it('supports cancellation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'))
            })
          }),
      ),
    )
    const controller = new AbortController()
    const pending = failure(request('/api/x', parser, { signal: controller.signal }))
    controller.abort()
    expect((await pending).kind).toBe('aborted')
  })

  it('rejects responses that fail validation', async () => {
    mockFetch(json(200, { ok: 42 }))
    const err = await failure(request('/api/x', parser))
    expect(err.kind).toBe('parse')
    expect(err.message).toMatch(/unexpected response/)
  })

  it('rejects invalid JSON (including NaN literals)', async () => {
    mockFetch(new Response('{"ok": NaN}', { status: 200 }))
    expect((await failure(request('/api/x', parser))).code).toBe('invalid_json')
  })

  it('refuses to send non-finite numbers', async () => {
    const fetch = mockFetch()
    const err = await failure(request('/api/x', parser, { method: 'POST', body: { depth: Number.NaN } }))
    expect(err.code).toBe('invalid_request_data')
    expect(fetch).not.toHaveBeenCalled()
  })
})
