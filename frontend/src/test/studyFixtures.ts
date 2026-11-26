/* Engine-shaped Monte Carlo study and survey design responses. Used only by tests. */
import { EXP_ID, HASH } from './fixtures'

const accuracy = (bias: number, rmse: number, k: number, n: number) => ({
  n,
  bias,
  rmse,
  coverage: { k, n, rate: k / n, low: Math.max(0, k / n - 0.2), high: Math.min(1, k / n + 0.1) },
})

function envelope(kind: string, id: string) {
  return {
    id,
    experiment_id: EXP_ID,
    experiment_version: 1,
    configuration_hash: HASH,
    kind,
    status: 'completed',
    progress: 1,
    created_at: '2026-10-06T10:00:00.000Z',
    completed_at: '2026-10-06T10:01:00.000Z',
    error: null,
  }
}

export function repeatStudyJson() {
  return {
    ...envelope('repeat', 'e'.repeat(32)),
    request: { kind: 'repeat', runs: 10, masses_kg: null, depths_m: null, mass_change_kg: null, interval_days: null },
    result: {
      kind: 'repeat',
      runs: 10,
      stations: 81,
      bootstrap_samples: 60,
      truth: { depth_m: 1500, mass_kg: 5e12, x_m: 400, y_m: -300 },
      detection: { k: 9, n: 10, rate: 0.9, low: 0.6, high: 0.98 },
      significance: { median: 4.6, values: [4.6, 5.1, 2.2, 4.4, 4.8, 3.9, 6.0, 4.7, 4.5, 5.2] },
      accuracy_all: { depth_m: accuracy(120, 300, 8, 10), mass_kg: accuracy(4e11, 1e12, 9, 10), x_m: accuracy(-10, 90, 10, 10), y_m: accuracy(5, 80, 10, 10) },
      accuracy_detected: { depth_m: accuracy(100, 280, 8, 9), mass_kg: accuracy(3e11, 9e11, 8, 9), x_m: accuracy(-8, 85, 9, 9), y_m: accuracy(4, 75, 9, 9) },
      records: [
        {
          seed: 1,
          detected: true,
          significance_sigma: 4.6,
          depth_m: 1650,
          mass_kg: 5.4e12,
          x_m: 390,
          y_m: -310,
          truth_within_ci: { depth_m: true, mass_kg: true, x_m: true, y_m: true },
        },
      ],
    },
  }
}

export function sweepStudyJson() {
  return {
    ...envelope('sweep', 'f'.repeat(32)),
    request: { kind: 'sweep', runs: 20, masses_kg: [1e12, 1e13], depths_m: [1000, 2000], mass_change_kg: null, interval_days: null },
    result: {
      kind: 'sweep',
      runs_per_cell: 20,
      stations: 81,
      masses_kg: [1e12, 1e13],
      depths_m: [1000, 2000],
      detection: [
        [{ k: 1, n: 20, rate: 0.05, low: 0.01, high: 0.24 }, null],
        [{ k: 0, n: 20, rate: 0, low: 0, high: 0.16 }, { k: 20, n: 20, rate: 1, low: 0.84, high: 1 }],
      ],
      predicted_probability: [
        [0.02, null],
        [0, 0.99],
      ],
      effective_trials: 46.7,
      threshold_sigma: 3,
      note: 'Cells where the body would reach above the ground are left empty.',
    },
  }
}

export function designJson() {
  const candidate = {
    spacing_m: 5000,
    stations: 81,
    averaging_time_s: 10800,
    duration_days: 34.6,
    nominal_sigma: 1.4e-17,
    expected_significance_sigma: 4.7,
    detection_probability: 0.92,
    within_budget: true,
    resolves_depth: true,
  }
  return {
    target: { mass_kg: 6.4e14, depth_m: 10000, x_m: 3000, y_m: -2000 },
    max_days: 40,
    target_probability: 0.9,
    threshold_sigma: 3,
    verdict: 'reliable',
    recommended: candidate,
    candidates: [candidate, { ...candidate, averaging_time_s: 3600, duration_days: 25, detection_probability: 0.6, expected_significance_sigma: 3.2 }],
    assumptions: 'Survey area as configured.',
  }
}
