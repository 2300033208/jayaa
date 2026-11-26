/* Test fixtures shaped exactly like engine responses. Used only by tests. */
import defaults from '../../../contract/default-config.json'
import type { MeasurementRow } from '../types/api'
import { MEASUREMENT_FIELDS } from '../types/api'

export const EXP_ID = 'a'.repeat(32)
export const SIM_ID = 'b'.repeat(32)
export const OTHER_SIM_ID = 'c'.repeat(32)
export const HASH = 'd'.repeat(64)

export function defaultConfig(): typeof defaults {
  return structuredClone(defaults)
}

export function experimentJson(latest: Record<string, unknown> | null = null) {
  return {
    id: EXP_ID,
    code: 'EXP-00001',
    name: defaults.name,
    created_at: '2026-09-27T00:00:00.000Z',
    updated_at: '2026-09-27T00:00:00.000Z',
    version: 1,
    configuration_hash: HASH,
    config: defaultConfig(),
    latest_simulation: latest,
  }
}

export function statusJson(overrides: Record<string, unknown> = {}) {
  return {
    id: SIM_ID,
    experiment_id: EXP_ID,
    experiment_version: 1,
    configuration_hash: HASH,
    status: 'running',
    phase: 'running_survey',
    stage: 'measurement',
    progress: 0.5,
    measurements_completed: 0,
    measurements_total: 4,
    running_snr: null,
    playback: 'normal',
    created_at: '2026-09-27T00:00:00.000Z',
    updated_at: '2026-09-27T00:00:00.000Z',
    completed_at: null,
    error: null,
    results_available: false,
    last_seq: 1,
    ...overrides,
  }
}

export function row(index: number, overrides: Partial<MeasurementRow> = {}): MeasurementRow {
  return {
    index,
    timestamp_s: index * 10,
    x_m: index * 250,
    y_m: 0,
    z_m: 2,
    along_track_m: index * 250,
    line_index: 0,
    potential_m2_s2: -0.01,
    gravity_m_s2: 9.78,
    gravity_anomaly_m_s2: 1e-6,
    fractional_shift: -1e-19,
    absolute_shift_hz: -4e-5,
    ai_phase_rad: 0.01,
    raw: -1.2e-19,
    noise: -2e-20,
    z_score: index < 4 ? null : 0.5,
    ...overrides,
  }
}

export function columns(rows: readonly MeasurementRow[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {}
  for (const field of MEASUREMENT_FIELDS) out[field] = rows.map((r) => r[field])
  return out
}

export function batchEvent(seq: number, rows: readonly MeasurementRow[], simulationId = SIM_ID) {
  return {
    type: 'measurement_batch',
    simulation_id: simulationId,
    seq,
    start_index: rows[0]?.index ?? 0,
    count: rows.length,
    columns: columns(rows),
  }
}

export const DETECTION_DESCRIPTION =
  'A buried point mass anywhere on the search grid improves the fit over offset and drift alone by at least 3σ, after correcting for the number of positions and depths searched'

export const summaryJson = {
  anomaly_detected: true,
  detection_description: DETECTION_DESCRIPTION,
  detection_significance_sigma: 23.5,
  primary_source: {
    id: 'S1',
    mass_kg: 5.5e12,
    x_m: 336.3,
    y_m: -372,
    depth_m: 1659,
    depth_ci_low: 1360,
    depth_ci_high: 2022,
    mass_ci_low: 4.4e12,
    mass_ci_high: 7e12,
    mass_significance_sigma: 7.7,
  },
  peak_observed_deviation: 2e-18,
  measurement_count: 4,
}

export function planJson(pointCount = 4) {
  const xs = Array.from({ length: pointCount }, (_, i) => i * 250)
  return {
    simulation_id: SIM_ID,
    pattern: 'profile',
    nx: pointCount,
    ny: 1,
    point_count: pointCount,
    duration_s: pointCount * 1000,
    sensor_mode: 'local_reference',
    reference: { x_m: 0, y_m: 0, z_m: 2 },
    bounds: { width_m: 8000, length_m: 8000 },
    sensor_height_m: 2,
    path: { x_m: xs, y_m: xs.map(() => 0), z_m: xs.map(() => 2) },
    terrain: { x_m: [-4000, 4000], y_m: [-4000, 4000], elevation_m: [[0, 0], [0, 0]] },
    bodies: [
      { id: 'body-1', anomaly_type: 'dense', geometry: 'sphere', mass_kg: 5e12, x_m: 400, y_m: -300, depth_m: 1500, size_x_m: 1853, size_y_m: 1853, size_z_m: 1853 },
    ],
  }
}

/** A small engine-shaped detectability study: 3 depths × 4 masses. */
export function detectabilityJson() {
  const masses = [1e10, 1e11, 1e12, 1e13]
  const depths = [125, 1000, 8000]
  return {
    threshold_sigma: 3,
    depths_m: depths,
    masses_kg: masses,
    significance_sigma: [
      [0, 0.4, 9.5, 60],
      [0, 0, 2.1, 30],
      [0, 0, 0, 1.2],
    ],
    min_detectable_mass_kg: [6e11, 1.5e12, 2.1e13],
    position: { x_m: 400, y_m: -300 },
    resolution_depth_m: 125,
    nominal_sigma: 5.3e-19,
    station_count: 1089,
    effective_trials: 62.8,
    bodies: [{ id: 'body-1', mass_kg: 5e12, depth_m: 1500, expected_significance_sigma: 24.6 }],
    assumptions: 'Point source at the position of the first body.',
  }
}

export function resultsJson() {
  return {
    simulation_id: SIM_ID,
    experiment_id: EXP_ID,
    experiment_version: 1,
    configuration_hash: HASH,
    status: 'completed',
    completed_at: '2026-09-27T00:01:00.000Z',
    summary: summaryJson,
    noise_budget: {
      components: [
        { id: 'clock_instability', label: 'Clock instability', sigma: 4.5e-19, kind: 'white', description: 'Two-clock comparison' },
        { id: 'clock_systematic', label: 'Clock systematic (per set-up)', sigma: 1e-19, kind: 'station', description: 'Residual systematic shift after each set-up' },
      ],
      white_sigma: 5e-19,
      environmental_sigma: 3e-20,
      nominal_sigma: 5.1e-19,
    },
    comparison: {
      matching: 'optimal assignment on 3D centre distance',
      matches: [
        {
          truth_id: 'body-1',
          source_id: 'S1',
          depth_error_m: 159,
          mass_error_percent: 10.3,
          mass_error_kg: 5e11,
          x_error_m: -63.7,
          y_error_m: -72,
          horizontal_error_m: 96.2,
          location_error_m: 186,
          truth_within_ci: { mass_kg: true, x_m: true, y_m: true, depth_m: true },
        },
      ],
      unmatched_truth_ids: [],
      unmatched_source_ids: [],
      field_rmse_fractional: 2.8e-20,
      field_rmse_relative: 0.015,
      gravity_rmse_m_s2: 2.9e-6,
      signal_amplitude_fractional: 1.9e-18,
      noise_rms_fractional: 5e-19,
      snr: 3.69,
      snr_definition: 'Peak-to-peak noise-free anomaly signal divided by the RMS of the injected noise',
    },
    ground_truth: {
      bodies: [
        { id: 'body-1', anomaly_type: 'dense', geometry: 'sphere', mass_kg: 5e12, density_contrast_kg_m3: 1500, x_m: 400, y_m: -300, depth_m: 1500, top_depth_m: 573, size_x_m: 1853, size_y_m: 1853, size_z_m: 1853 },
      ],
    },
  }
}
