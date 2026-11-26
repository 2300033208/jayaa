import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeEngine } from '../test/fakeEngine'
import { FakeSocket } from '../test/fakeSocket'
import { SIM_ID, batchEvent, defaultConfig, row, statusJson, summaryJson } from '../test/fixtures'
import { App } from './App'

vi.mock('../components/charts/plotly', () => ({
  preloadPlotly: () => () => undefined,
  loadPlotly: () =>
    Promise.resolve({
      react: vi.fn((el: HTMLElement) => Promise.resolve(Object.assign(el, { on: vi.fn() }))),
      purge: vi.fn(),
      downloadImage: vi.fn(),
      Plots: { resize: vi.fn() },
    }),
}))
vi.mock('../three/EarthScene', () => ({ default: () => <div data-testid="earth-scene" /> }))
vi.mock('../three/support', async (importOriginal) => ({ ...(await importOriginal<object>()), isWebGLAvailable: () => true }))

beforeEach(() => {
  FakeSocket.reset()
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('end-to-end workflow in the browser shell', () => {
  it('create → validate → start → receive measurements → complete → display results', async () => {
    const engine = installFakeEngine()
    const user = userEvent.setup()
    window.history.pushState({}, '', '/experiments/new')
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    expect(await screen.findByText('Configuration validated by the engine', {}, { timeout: 5000 })).toBeInTheDocument()

    // Invalid input is caught in the browser and never sent to the engine.
    const depth = screen.getByLabelText('Depth to centre')
    await user.clear(depth)
    await user.type(depth, '-5')
    expect(await screen.findAllByText('Depth must be greater than 0 m.')).not.toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Run simulation' }))
    expect(engine.requests.some((r) => r.method === 'POST' && r.path === '/api/experiments')).toBe(false)

    // Restore the default value: the configuration is valid again.
    await user.clear(depth)
    await user.type(depth, String(defaultConfig().bodies[0]?.depth_m))
    expect(await screen.findByText('Configuration validated by the engine', {}, { timeout: 5000 })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Run simulation' }))

    // Saved, validated by the engine, started, and exactly one live stream opened (StrictMode safe).
    await waitFor(() => {
      expect(FakeSocket.instances.filter((s) => !s.closed)).toHaveLength(1)
    })
    const posts = engine.requests.filter((r) => r.method === 'POST').map((r) => r.path)
    expect(posts).toContain('/api/experiments')
    expect(posts).toContain('/api/experiments/validate')
    expect(posts.filter((p) => p.endsWith('/simulations')).length).toBeGreaterThanOrEqual(1)
    const starts = engine.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/simulations'))
    const keys = new Set(starts.map((r) => JSON.stringify(r.body)))
    expect(keys.size).toBe(1)

    const ws = FakeSocket.instances.find((s) => !s.closed)
    if (ws === undefined) throw new Error('no socket')
    act(() => {
      ws.open()
      ws.send({ type: 'snapshot', simulation_id: SIM_ID, seq: 1, simulation: statusJson({ measurements_total: 4 }) })
      ws.send(batchEvent(2, [row(0), row(1), row(2), row(3)]))
      ws.send({
        type: 'simulation_progress',
        simulation_id: SIM_ID,
        seq: 3,
        progress: 0.85,
        phase: 'running_survey',
        measurements_completed: 4,
        measurements_total: 4,
        running_snr: 3.1,
      })
    })
    expect(await screen.findByText('4 / 4')).toBeInTheDocument()
    expect(screen.getByText('Live stream connected')).toBeInTheDocument()

    engine.completed = true
    act(() => {
      ws.send({
        type: 'simulation_completed',
        simulation_id: SIM_ID,
        seq: 4,
        simulation: statusJson({ status: 'completed', phase: 'complete', stage: 'complete', progress: 1, results_available: true, measurements_completed: 4, measurements_total: 4 }),
        summary: summaryJson,
      })
    })
    expect(await screen.findByText('Subsurface anomaly detected')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /open full analysis/i }))
    expect(await screen.findByText('Anomaly detected', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(await screen.findByText(/single profile has no second horizontal axis/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ground truth vs estimation' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /Estimated depth · 95 % interval/ })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\b(accurate|NaN|Infinity|undefined)\b/)
  }, 30_000)

  it('shows an honest error when the engine is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    window.history.pushState({}, '', '/history')
    render(<App />)
    expect(await screen.findByText('Simulation engine unavailable', {}, { timeout: 8000 })).toBeInTheDocument()
    // The session cannot be checked without the engine, so the page offers a retry instead of the app shell.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/All systems operational/)
  }, 30_000)
})
