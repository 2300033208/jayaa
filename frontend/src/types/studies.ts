/* Monte Carlo studies and the survey design assistant (engine wire format). */

export const STUDY_KINDS = ['repeat', 'sweep', 'time_lapse'] as const
export type StudyKind = (typeof STUDY_KINDS)[number]
export const STUDY_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const
export type StudyStatus = (typeof STUDY_STATUSES)[number]

export interface StudyRequest {
  kind: StudyKind
  runs: number
  masses_kg?: number[] | undefined
  depths_m?: number[] | undefined
  mass_change_kg?: number | undefined
  interval_days?: number | undefined
}

/** A proportion with its 95 % Wilson score interval. */
export interface Proportion {
  k: number
  n: number
  rate: number | null
  low: number | null
  high: number | null
}

export interface Accuracy {
  n: number
  bias: number | null
  rmse: number | null
  coverage: Proportion
}

export const REPEAT_PARAMETERS = ['depth_m', 'mass_kg', 'x_m', 'y_m'] as const
export type RepeatParameter = (typeof REPEAT_PARAMETERS)[number]
export const CHANGE_PARAMETERS = ['mass_change_kg', 'depth_m'] as const
export type ChangeParameter = (typeof CHANGE_PARAMETERS)[number]

export interface RepeatRecord {
  seed: number
  detected: boolean
  significance_sigma: number | null
  depth_m: number
  mass_kg: number
  x_m: number
  y_m: number
  truth_within_ci: Record<RepeatParameter, boolean | null>
}

export interface RepeatResult {
  kind: 'repeat'
  runs: number
  stations: number
  bootstrap_samples: number
  truth: Record<RepeatParameter, number>
  detection: Proportion
  significance: { median: number | null; values: number[] }
  accuracy_all: Record<RepeatParameter, Accuracy>
  accuracy_detected: Record<RepeatParameter, Accuracy>
  records: RepeatRecord[]
}

export interface SweepResult {
  kind: 'sweep'
  runs_per_cell: number
  stations: number
  masses_kg: number[]
  depths_m: number[]
  /** Rows by depth, columns by mass; null where the body would reach above the ground. */
  detection: (Proportion | null)[][]
  predicted_probability: (number | null)[][]
  effective_trials: number
  threshold_sigma: number
  note: string
}

export interface TimeLapseRecord {
  seed: number
  detected: boolean
  significance_sigma: number
  mass_change_kg: number
  depth_m: number
  truth_within_ci: Record<ChangeParameter, boolean | null>
}

export interface TimeLapseResult {
  kind: 'time_lapse'
  runs: number
  stations: number
  bootstrap_samples: number
  mass_change_kg: number
  interval_days: number
  mass_change_rate_kg_per_year: number
  truth: { mass_change_kg: number; depth_m: number; mass_before_kg: number; mass_after_kg: number }
  sigma_difference: number
  sigma_difference_without_benchmarks: number
  predicted_probability: number
  detection: Proportion
  significance: { median: number | null; values: number[] }
  accuracy_all: Record<ChangeParameter, Accuracy>
  accuracy_detected: Record<ChangeParameter, Accuracy>
  records: TimeLapseRecord[]
  note: string
}

export type StudyResult = RepeatResult | SweepResult | TimeLapseResult

export interface Study {
  id: string
  experiment_id: string
  experiment_version: number
  configuration_hash: string
  kind: StudyKind
  request: StudyRequest
  status: StudyStatus
  progress: number
  created_at: string
  completed_at: string | null
  error: { code: string; message: string } | null
  /** Present on the single-study endpoint once completed; omitted from listings. */
  result: StudyResult | null
}

export interface DesignCandidate {
  spacing_m: number
  stations: number
  averaging_time_s: number
  duration_days: number
  nominal_sigma: number
  expected_significance_sigma: number
  detection_probability: number
  within_budget: boolean
  resolves_depth: boolean
}

export interface DesignResult {
  target: { mass_kg: number; depth_m: number; x_m: number; y_m: number }
  max_days: number
  target_probability: number
  threshold_sigma: number
  verdict: 'reliable' | 'best_within_budget' | 'none_within_budget'
  recommended: DesignCandidate | null
  candidates: DesignCandidate[]
  assumptions: string
}
