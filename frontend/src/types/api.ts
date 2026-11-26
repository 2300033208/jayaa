import type { AnomalyType, ClockPreset, ExperimentConfig, Geometry, Playback, ScanPattern, SensorMode } from './config'

/* ------------------------------------------------------------------ experiments */

export const BACKEND_STATUSES = ['starting', 'running', 'paused', 'cancelling', 'cancelled', 'completed', 'failed'] as const
export type BackendStatus = (typeof BACKEND_STATUSES)[number]

export const PHASES = [
  'initializing_earth_model',
  'generating_subsurface_field',
  'initializing_sensor',
  'running_survey',
  'processing_measurements',
  'performing_inversion',
  'calculating_uncertainty',
  'complete',
] as const
export type Phase = (typeof PHASES)[number]

export const STAGES = ['setup', 'sensor', 'measurement', 'analysis', 'complete'] as const
export type Stage = (typeof STAGES)[number]

export interface LatestSimulation {
  id: string
  status: BackendStatus
  configuration_hash: string
  experiment_version: number
  created_at: string
  completed_at: string | null
  results_available: boolean
}

export interface Experiment {
  id: string
  code: string
  name: string
  created_at: string
  updated_at: string
  version: number
  configuration_hash: string
  config: ExperimentConfig
  latest_simulation: LatestSimulation | null
}

export interface ExperimentSummary {
  id: string
  code: string
  name: string
  created_at: string
  updated_at: string
  version: number
  configuration_hash: string
  body_count: number
  pattern: ScanPattern
  sensor_mode: SensorMode
  latest_simulation: LatestSimulation | null
}

export interface FieldMessage {
  field: string
  message: string
}

export interface DerivedBody {
  id: string
  volume_m3: number
  signed_mass_kg: number
  radius_m: number | null
  size_x_m: number
  size_y_m: number
  size_z_m: number
  top_depth_m: number
}

export interface DerivedQuantities {
  bodies: DerivedBody[]
  survey: { nx: number; ny: number; point_count: number; duration_s: number; path_length_m: number }
  noise: { white_sigma: number; environmental_sigma: number; nominal_sigma: number }
  forward_estimate: {
    peak_fractional_shift: number
    peak_gravity_anomaly_m_s2: number
    per_point_snr: number | null
  }
}

export interface ValidationResult {
  valid: boolean
  errors: FieldMessage[]
  warnings: FieldMessage[]
  derived: DerivedQuantities | null
}

export interface Scenario {
  id: string
  title: string
  summary: string
  expectation: string
  config: ExperimentConfig
}

export interface Defaults {
  config: ExperimentConfig
  presets: ClockPreset[]
  scenarios: { default: string; note: string; scenarios: Scenario[] }
}

/** Expected detection significance over source mass (columns) and depth (rows). */
export interface DetectabilityStudy {
  threshold_sigma: number
  depths_m: number[]
  masses_kg: number[]
  significance_sigma: number[][]
  min_detectable_mass_kg: (number | null)[]
  position: { x_m: number; y_m: number }
  resolution_depth_m: number
  nominal_sigma: number
  station_count: number
  effective_trials: number
  bodies: { id: string; mass_kg: number; depth_m: number; expected_significance_sigma: number | null }[]
  assumptions: string
}

/* ------------------------------------------------------------------ simulations */

export interface SimulationError {
  code: string
  phase: string
  message: string
}

export interface SimulationStatusDoc {
  id: string
  experiment_id: string
  experiment_version: number
  configuration_hash: string
  status: BackendStatus
  phase: Phase
  stage: Stage
  progress: number
  measurements_completed: number
  measurements_total: number
  running_snr: number | null
  playback: Playback
  created_at: string
  updated_at: string
  completed_at: string | null
  error: SimulationError | null
  results_available: boolean
  last_seq: number
}

export interface PlanBody {
  id: string
  anomaly_type: AnomalyType
  geometry: Geometry
  mass_kg: number
  x_m: number
  y_m: number
  depth_m: number
  size_x_m: number
  size_y_m: number
  size_z_m: number
}

export interface SurveyPlan {
  simulation_id: string | null
  pattern: ScanPattern
  nx: number
  ny: number
  point_count: number
  duration_s: number
  sensor_mode: SensorMode
  reference: { x_m: number; y_m: number; z_m: number } | null
  bounds: { width_m: number; length_m: number }
  sensor_height_m: number
  path: { x_m: number[]; y_m: number[]; z_m: number[] }
  terrain: { x_m: number[]; y_m: number[]; elevation_m: number[][] }
  bodies: PlanBody[]
}

/** Numeric measurement columns in engine order. `z_score` may be null (insufficient baseline). */
export const MEASUREMENT_FIELDS = [
  'index',
  'timestamp_s',
  'x_m',
  'y_m',
  'z_m',
  'along_track_m',
  'line_index',
  'potential_m2_s2',
  'gravity_m_s2',
  'gravity_anomaly_m_s2',
  'fractional_shift',
  'absolute_shift_hz',
  'ai_phase_rad',
  'raw',
  'noise',
  'z_score',
] as const
export type MeasurementField = (typeof MEASUREMENT_FIELDS)[number]

export type MeasurementRow = Record<Exclude<MeasurementField, 'z_score'>, number> & { z_score: number | null }

export interface MeasurementBatch {
  startIndex: number
  rows: MeasurementRow[]
  rejected: number
}

export interface MeasurementPage {
  simulation_id: string
  status: BackendStatus
  start_index: number
  count: number
  available: number
  total: number
  batch: MeasurementBatch
}

/* ------------------------------------------------------------------ results */

export interface ResultEnvelope {
  simulation_id: string
  experiment_id: string
  experiment_version: number
  configuration_hash: string
  status: BackendStatus
  completed_at: string | null
}

export const NOISE_KINDS = ['white', 'station', 'correlated', 'systematic'] as const
export type NoiseKind = (typeof NOISE_KINDS)[number]

export interface NoiseComponent {
  id: string
  label: string
  sigma: number
  kind: NoiseKind
  description: string
}

export interface ResultSummary {
  anomaly_detected: boolean
  detection_description: string
  /** Look-elsewhere-corrected significance of the matched-filter scan (null when unavailable). */
  detection_significance_sigma: number | null
  primary_source: {
    id: string
    mass_kg: number
    x_m: number
    y_m: number
    depth_m: number
    depth_ci_low: number | null
    depth_ci_high: number | null
    mass_ci_low: number | null
    mass_ci_high: number | null
    /** |estimated mass| / its standard deviation: how well the mass is constrained. */
    mass_significance_sigma: number | null
  }
  peak_observed_deviation: number
  measurement_count: number
}

export interface TruthBody {
  id: string
  anomaly_type: AnomalyType
  geometry: Geometry
  mass_kg: number
  density_contrast_kg_m3: number
  x_m: number
  y_m: number
  depth_m: number
  top_depth_m: number
  size_x_m: number
  size_y_m: number
  size_z_m: number
}

export interface CiFlags {
  mass_kg: boolean | null
  x_m: boolean | null
  y_m: boolean | null
  depth_m: boolean | null
}

export interface ComparisonMatch {
  truth_id: string
  source_id: string
  depth_error_m: number
  mass_error_percent: number
  mass_error_kg: number
  x_error_m: number
  y_error_m: number
  horizontal_error_m: number
  location_error_m: number
  truth_within_ci: CiFlags
}

export interface Comparison {
  matching: string
  matches: ComparisonMatch[]
  unmatched_truth_ids: string[]
  unmatched_source_ids: string[]
  field_rmse_fractional: number
  field_rmse_relative: number | null
  gravity_rmse_m_s2: number
  signal_amplitude_fractional: number
  noise_rms_fractional: number
  snr: number | null
  snr_definition: string
}

export interface Results extends ResultEnvelope {
  summary: ResultSummary
  noise_budget: {
    components: NoiseComponent[]
    white_sigma: number
    environmental_sigma: number
    nominal_sigma: number
  }
  comparison: Comparison
  ground_truth: { bodies: TruthBody[] }
}

export interface Estimate {
  estimate: number
  std_error: number | null
}

export interface SourceEstimate {
  id: string
  mass_kg: Estimate
  x_m: Estimate
  y_m: Estimate
  depth_m: Estimate
  mass_significance_sigma: number | null
}

export interface InversionDoc {
  model: string
  source_count: number
  sources: SourceEstimate[]
  offset: Estimate
  drift_per_s: Estimate
  fit: {
    converged: boolean
    message: string
    evaluations: number
    n_points: number
    n_parameters: number
    residual_rms: number
    reduced_chi_square: number | null
    covariance_available: boolean
    /** Shallowest depth the station spacing can resolve; estimates are bounded below by it. */
    min_depth_m: number
  }
  detection: {
    criterion_sigma: number
    method: string
    description: string
    anomaly_detected: boolean
    significance_sigma: number | null
    delta_chi_square: number | null
    effective_trials: number | null
    null_samples: number
    null_exceedance: number | null
  }
}

export const UNCERTAINTY_PARAMETERS = ['mass_kg', 'depth_m', 'x_m', 'y_m'] as const
export type UncertaintyParameter = (typeof UNCERTAINTY_PARAMETERS)[number]

export interface ParameterUncertainty {
  unit: string
  estimate: number
  std_error: number | null
  bootstrap_std: number | null
  ci_low: number | null
  ci_high: number | null
  histogram: { bin_edges: number[]; counts: number[] } | null
}

export interface UncertaintyDoc {
  method: string
  confidence_level: number
  requested_samples: number
  samples_used: number
  converged_samples: number
  block_length: number
  capped: boolean
  sources: { source_id: string; parameters: Record<UncertaintyParameter, ParameterUncertainty> }[]
}

export const MAP_LAYERS = [
  'gravity_anomaly_true',
  'gravity_anomaly_estimated',
  'observed_shift',
  'filtered_shift',
  'residual',
  'raw',
  'fractional_shift',
] as const
export type MapLayer = (typeof MAP_LAYERS)[number]

export interface AnomalyMapDoc {
  available: boolean
  unavailable_reason: string | null
  nx: number
  ny: number
  x_m: number[]
  y_m: number[]
  layers: Record<MapLayer, number[][]> | null
  measurement_index: number[][] | null
}

export interface SignalsDoc {
  index: number[]
  filtered: number[]
  drift_corrected: number[]
  residual: number[]
  model_prediction: number[]
  estimated_gravity_anomaly_m_s2: number[]
  filter_description: string
}

export interface ResultSection<T> extends ResultEnvelope {
  data: T
}

/* ------------------------------------------------------------------ websocket events */

export type SimulationEvent =
  | { type: 'snapshot'; simulation_id: string; seq: number; simulation: SimulationStatusDoc }
  | { type: 'simulation_started'; simulation_id: string; seq: number; simulation: SimulationStatusDoc }
  | { type: 'simulation_paused'; simulation_id: string; seq: number; simulation: SimulationStatusDoc }
  | { type: 'simulation_resumed'; simulation_id: string; seq: number; simulation: SimulationStatusDoc }
  | { type: 'simulation_cancelling'; simulation_id: string; seq: number; simulation: SimulationStatusDoc }
  | { type: 'simulation_cancelled'; simulation_id: string; seq: number; simulation: SimulationStatusDoc }
  | {
      type: 'simulation_completed'
      simulation_id: string
      seq: number
      simulation: SimulationStatusDoc
      summary: ResultSummary
    }
  | {
      type: 'simulation_failed'
      simulation_id: string
      seq: number
      simulation: SimulationStatusDoc
      error: SimulationError
    }
  | { type: 'phase_changed'; simulation_id: string; seq: number; phase: Phase; stage: Stage; progress: number }
  | {
      type: 'simulation_progress'
      simulation_id: string
      seq: number
      progress: number
      phase: Phase
      measurements_completed: number
      measurements_total: number
      running_snr: number | null
    }
  | { type: 'measurement_batch'; simulation_id: string; seq: number; batch: MeasurementBatch }
  | { type: 'heartbeat'; simulation_id: string; seq: number }
