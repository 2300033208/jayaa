/*
 * In-memory stand-in for the engine's HTTP API, returning the exact wire formats. Used only by
 * integration tests (production code never falls back to this).
 */
import { vi } from 'vitest'
import clockPresets from '../../../contract/clock-presets.json'
import scenarios from '../../../contract/scenarios.json'
import { DETECTION_DESCRIPTION, EXP_ID, HASH, SIM_ID, columns, defaultConfig, detectabilityJson, experimentJson, planJson, resultsJson, row, statusJson } from './fixtures'

const POINTS = 4

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function envelope() {
  return { simulation_id: SIM_ID, experiment_id: EXP_ID, experiment_version: 1, configuration_hash: HASH, status: 'completed', completed_at: '2026-09-27T00:01:00.000Z' }
}

const estimate = (value: number, std: number) => ({ estimate: value, std_error: std })
const param = (unit: string, value: number, lo: number, hi: number) => ({
  unit,
  estimate: value,
  std_error: (hi - lo) / 4,
  bootstrap_std: (hi - lo) / 4,
  ci_low: lo,
  ci_high: hi,
  histogram: { bin_edges: [lo, value, hi], counts: [12, 8] },
})

export interface FakeEngine {
  requests: { method: string; path: string; body: unknown }[]
  simulationStatus: string
  completed: boolean
}

export function installFakeEngine(): FakeEngine {
  const state: FakeEngine = { requests: [], simulationStatus: 'none', completed: false }
  let created = false

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    const path = url.pathname
    state.requests.push({ method, path, body })
    await Promise.resolve()

    const latest =
      state.simulationStatus === 'none'
        ? null
        : { id: SIM_ID, status: state.completed ? 'completed' : 'running', configuration_hash: HASH, experiment_version: 1, created_at: 'x', completed_at: null, results_available: state.completed }
    const simStatus = () =>
      statusJson(
        state.completed
          ? { status: 'completed', phase: 'complete', stage: 'complete', progress: 1, results_available: true, measurements_completed: POINTS, measurements_total: POINTS }
          : { measurements_total: POINTS },
      )

    if (path === '/api/health') return json(200, { status: 'ok', engine_version: 'test' })
    if (path === '/api/auth/me') return json(200, { user: { id: 'f'.repeat(32), email: 'researcher@example.org', display_name: 'Test researcher', created_at: '2026-09-27T00:00:00.000Z' } })
    if (path === '/api/auth/config') return json(200, { signup_allowed: true, password_min_length: 12 })
    if (path === '/api/defaults') return json(200, { config: defaultConfig(), presets: clockPresets, scenarios })
    if (path === '/api/experiments/detectability') return json(200, detectabilityJson())
    if (path === '/api/experiments/validate') {
      return json(200, {
        valid: true,
        errors: [],
        warnings: [],
        derived: {
          bodies: [],
          survey: { nx: 33, ny: 33, point_count: 1089, duration_s: 1142900, path_length_m: 272000 },
          noise: { white_sigma: 5e-19, environmental_sigma: 3e-20, nominal_sigma: 5.1e-19 },
          forward_estimate: { peak_fractional_shift: -2.47e-18, peak_gravity_anomaly_m_s2: 1.48e-4, per_point_snr: 4.8 },
        },
      })
    }
    if (path === '/api/experiments' && method === 'POST') {
      created = true
      return json(201, experimentJson(latest))
    }
    if (path === '/api/experiments' && method === 'GET') return json(200, { items: [] })
    if (path === `/api/experiments/${EXP_ID}`) return created ? json(200, experimentJson(latest)) : json(404, { error: { code: 'not_found', message: 'Experiment not found.', fields: [] } })
    if (path === `/api/experiments/${EXP_ID}/plan`) return json(200, { ...planJson(POINTS), simulation_id: null })
    if (path === `/api/experiments/${EXP_ID}/simulations` && method === 'POST') {
      state.simulationStatus = 'running'
      return json(201, statusJson({ status: 'starting', phase: 'initializing_earth_model', stage: 'setup', progress: 0, measurements_total: POINTS }))
    }
    if (path === `/api/experiments/${EXP_ID}/simulations`) return json(200, { items: [simStatus()] })
    if (path === `/api/simulations/${SIM_ID}`) return json(200, simStatus())
    if (path === `/api/simulations/${SIM_ID}/plan`) return json(200, planJson(POINTS))
    if (path === `/api/simulations/${SIM_ID}/measurements`) {
      const rows = state.completed ? Array.from({ length: POINTS }, (_, i) => row(i)) : []
      return json(200, { simulation_id: SIM_ID, status: state.completed ? 'completed' : 'running', start_index: 0, count: rows.length, available: rows.length, total: POINTS, columns: rows.length ? columns(rows) : null })
    }
    if (path === `/api/simulations/${SIM_ID}/results`) return json(200, resultsJson())
    if (path === `/api/simulations/${SIM_ID}/results/inversion`) {
      return json(200, {
        ...envelope(),
        data: {
          model: 'point masses + offset + linear drift',
          source_count: 1,
          sources: [{ id: 'S1', mass_kg: estimate(5.5e12, 7e11), x_m: estimate(336.3, 120), y_m: estimate(-372, 150), depth_m: estimate(1659, 170), mass_significance_sigma: 7.7 }],
          offset: estimate(1e-20, 1e-21),
          drift_per_s: estimate(2e-25, 1e-26),
          fit: { converged: true, message: 'ok', evaluations: 8, n_points: POINTS, n_parameters: 6, residual_rms: 5e-19, reduced_chi_square: 0.99, covariance_available: true, min_depth_m: 125 },
          detection: {
            criterion_sigma: 3,
            method: 'matched-filter scan with look-elsewhere correction',
            description: DETECTION_DESCRIPTION,
            anomaly_detected: true,
            significance_sigma: 23.5,
            delta_chi_square: 590,
            effective_trials: 62.8,
            null_samples: 4000,
            null_exceedance: 0,
          },
        },
      })
    }
    if (path === `/api/simulations/${SIM_ID}/results/uncertainty`) {
      return json(200, {
        ...envelope(),
        data: {
          method: 'moving-block residual bootstrap',
          confidence_level: 0.95,
          requested_samples: 20,
          samples_used: 20,
          converged_samples: 20,
          block_length: 2,
          capped: false,
          sources: [
            {
              source_id: 'S1',
              parameters: {
                mass_kg: param('kg', 5.5e12, 4.4e12, 7e12),
                depth_m: param('m', 1659, 1360, 2022),
                x_m: param('m', 336.3, 60, 600),
                y_m: param('m', -372, -700, -40),
              },
            },
          ],
        },
      })
    }
    if (path === `/api/simulations/${SIM_ID}/results/anomaly-map`) {
      return json(200, {
        ...envelope(),
        data: { available: false, unavailable_reason: 'A single profile has no second horizontal axis, so a 2D anomaly map cannot be formed without interpolation.', nx: POINTS, ny: 1, x_m: [0, 250, 500, 750], y_m: [0], layers: null, measurement_index: null },
      })
    }
    if (path === `/api/simulations/${SIM_ID}/results/signals`) {
      const n = Array.from({ length: POINTS }, (_, i) => i)
      return json(200, {
        ...envelope(),
        data: { index: n, filtered: n.map(() => -1e-19), drift_corrected: n.map(() => -1e-19), residual: n.map(() => 1e-20), model_prediction: n.map(() => -1.1e-19), estimated_gravity_anomaly_m_s2: n.map(() => 1e-6), filter_description: 'test' },
      })
    }
    return json(404, { error: { code: 'not_found', message: `No fake route for ${method} ${path}`, fields: [] } })
  }

  vi.stubGlobal('fetch', vi.fn(handler))
  return state
}
