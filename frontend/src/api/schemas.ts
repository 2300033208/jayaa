import type {
  AnomalyMapDoc,
  Defaults,
  DetectabilityStudy,
  Comparison,
  DerivedQuantities,
  Estimate,
  Experiment,
  ExperimentSummary,
  FieldMessage,
  InversionDoc,
  LatestSimulation,
  MeasurementBatch,
  MeasurementRow,
  NoiseComponent,
  ParameterUncertainty,
  ResultEnvelope,
  Results,
  ResultSummary,
  Scenario,
  SignalsDoc,
  SimulationError,
  SimulationStatusDoc,
  SourceEstimate,
  SurveyPlan,
  TruthBody,
  UncertaintyDoc,
  ValidationResult,
} from '../types/api'
import { BACKEND_STATUSES, MAP_LAYERS, MEASUREMENT_FIELDS, NOISE_KINDS, PHASES, STAGES, UNCERTAINTY_PARAMETERS } from '../types/api'
import type { BodyConfig, ClockPerformance, ClockPreset, ExperimentConfig } from '../types/config'
import {
  ANOMALY_TYPES,
  CLOCK_SPECIES,
  EARTH_MODELS,
  GEOMETRIES,
  PERFORMANCE_CLASSES,
  PLAYBACKS,
  SCAN_PATTERNS,
  SENSOR_MODES,
  TERRAINS,
  TIDES,
} from '../types/config'
import type { Parser } from './parse'
import {
  ParseError,
  array,
  boolean,
  finite,
  finiteArray,
  fraction,
  integer,
  isRecord,
  literal,
  matrix,
  nonNegativeInteger,
  nullable,
  object,
  record,
  refine,
  string,
} from './parse'

export const id = refine(string, (v) => (/^[0-9a-f]{32}$/.test(v) ? null : 'expected a 32-character hex identifier'))
export const hash = refine(string, (v) => (/^[0-9a-f]{64}$/.test(v) ? null : 'expected a SHA-256 hex digest'))
export const positive = refine(finite, (v) => (v > 0 ? null : 'expected a positive number'))
export const nonNegative = refine(finite, (v) => (v >= 0 ? null : 'expected a non-negative number'))
const backendStatus = literal(BACKEND_STATUSES)
const isoDate = refine(string, (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'expected a date as YYYY-MM-DD'))

/* ------------------------------------------------------------------ configuration */

const body: Parser<BodyConfig> = object<BodyConfig>({
  id: string,
  anomaly_type: literal(ANOMALY_TYPES),
  geometry: literal(GEOMETRIES),
  density_contrast_kg_m3: finite,
  mass_kg: finite,
  depth_m: finite,
  x_m: finite,
  y_m: finite,
})

export const parseConfig: Parser<ExperimentConfig> = object<ExperimentConfig>({
  name: string,
  environment: object({
    earth_model: literal(EARTH_MODELS),
    latitude_deg: finite,
    longitude_deg: finite,
    elevation_m: finite,
    terrain: literal(TERRAINS),
    terrain_relief_m: finite,
    terrain_model_id: nullable(id),
    terrain_density_kg_m3: finite,
    terrain_density_assumed_kg_m3: finite,
    tides: literal(TIDES),
  }),
  bodies: array(body),
  sensor: object({
    mode: literal(SENSOR_MODES),
    clock_species: literal(CLOCK_SPECIES),
    performance_class: literal(PERFORMANCE_CLASSES),
    reference_frequency_hz: finite,
    bbr_sensitivity_per_k: finite,
    measurement_interval_s: finite,
    stability_1s: finite,
    systematic_uncertainty: finite,
    uptime_percent: finite,
    reference_distance_km: finite,
  }),
  noise: object({
    measurement_noise: finite,
    frequency_drift_per_hour: finite,
    environmental_noise: finite,
    temperature_fluctuation_k: finite,
    vibration_m: finite,
    station_height_uncertainty_m: finite,
    tide_residual_percent: finite,
    seed: integer,
  }),
  survey: object({
    width_m: finite,
    length_m: finite,
    spacing_m: finite,
    sensor_height_m: finite,
    setup_time_s: finite,
    start_date: isoDate,
    pattern: literal(SCAN_PATTERNS),
  }),
  inversion: object({ source_count: integer, bootstrap_samples: integer }),
})

const clockPerformance: Parser<ClockPerformance> = object<ClockPerformance>({
  stability_1s: positive,
  systematic_uncertainty: nonNegative,
  uptime_percent: positive,
  basis: string,
})

export const parseClockPreset: Parser<ClockPreset> = object<ClockPreset>({
  id: literal(['sr', 'yb', 'al_ion', 'cs'] as const),
  label: string,
  reference_frequency_hz: positive,
  bbr_sensitivity_per_k: nonNegative,
  performance: object({ field: clockPerformance, laboratory: clockPerformance, projected: clockPerformance }),
})

const scenario: Parser<Scenario> = object<Scenario>({
  id: string,
  title: string,
  summary: string,
  expectation: string,
  config: parseConfig,
})

export const parseDefaults: Parser<Defaults> = (value, path) => {
  const outer = object({
    config: parseConfig,
    presets: object({ presets: array(parseClockPreset) }),
    scenarios: refine(object({ default: string, note: string, scenarios: array(scenario) }), (s) =>
      s.scenarios.some((item) => item.id === s.default) ? null : 'default scenario must be listed',
    ),
  })(value, path)
  return { config: outer.config, presets: outer.presets.presets, scenarios: outer.scenarios }
}

export const parseDetectability: Parser<DetectabilityStudy> = refine(
  object<DetectabilityStudy>({
    threshold_sigma: positive,
    depths_m: finiteArray,
    masses_kg: finiteArray,
    significance_sigma: array(finiteArray),
    min_detectable_mass_kg: array(nullable(positive)),
    position: object({ x_m: finite, y_m: finite }),
    resolution_depth_m: positive,
    nominal_sigma: nonNegative,
    station_count: nonNegativeInteger,
    effective_trials: positive,
    bodies: array(
      object({ id: string, mass_kg: nonNegative, depth_m: positive, expected_significance_sigma: nullable(nonNegative) }),
    ),
    assumptions: string,
  }),
  (d) => {
    if (d.depths_m.length === 0 || d.masses_kg.length === 0) return 'study grid must not be empty'
    if (d.significance_sigma.length !== d.depths_m.length) return 'expected one significance row per depth'
    if (d.significance_sigma.some((row) => row.length !== d.masses_kg.length)) return 'expected one value per mass in every row'
    if (d.min_detectable_mass_kg.length !== d.depths_m.length) return 'expected one minimum mass per depth'
    if ([...d.depths_m, ...d.masses_kg].some((v) => v <= 0)) return 'axes must be positive'
    return null
  },
)

/* ------------------------------------------------------------------ experiments */

const latestSimulation: Parser<LatestSimulation> = object<LatestSimulation>({
  id,
  status: backendStatus,
  configuration_hash: hash,
  experiment_version: integer,
  created_at: string,
  completed_at: nullable(string),
  results_available: boolean,
})

export const parseExperiment: Parser<Experiment> = object<Experiment>({
  id,
  code: string,
  name: string,
  created_at: string,
  updated_at: string,
  version: integer,
  configuration_hash: hash,
  config: parseConfig,
  latest_simulation: nullable(latestSimulation),
})

export const parseExperimentList: Parser<ExperimentSummary[]> = (value, path) =>
  object({
    items: array(
      object<ExperimentSummary>({
        id,
        code: string,
        name: string,
        created_at: string,
        updated_at: string,
        version: integer,
        configuration_hash: hash,
        body_count: nonNegativeInteger,
        pattern: literal(SCAN_PATTERNS),
        sensor_mode: literal(SENSOR_MODES),
        latest_simulation: nullable(latestSimulation),
      }),
    ),
  })(value, path).items

const fieldMessage: Parser<FieldMessage> = object<FieldMessage>({ field: string, message: string })

const derived: Parser<DerivedQuantities> = object<DerivedQuantities>({
  bodies: array(
    object({
      id: string,
      volume_m3: positive,
      signed_mass_kg: finite,
      radius_m: nullable(positive),
      size_x_m: positive,
      size_y_m: positive,
      size_z_m: positive,
      top_depth_m: finite,
    }),
  ),
  survey: object({
    nx: nonNegativeInteger,
    ny: nonNegativeInteger,
    point_count: nonNegativeInteger,
    duration_s: nonNegative,
    path_length_m: nonNegative,
  }),
  noise: object({ white_sigma: nonNegative, environmental_sigma: nonNegative, nominal_sigma: nonNegative }),
  forward_estimate: object({
    peak_fractional_shift: finite,
    peak_gravity_anomaly_m_s2: finite,
    per_point_snr: nullable(nonNegative),
  }),
})

export const parseValidation: Parser<ValidationResult> = object<ValidationResult>({
  valid: boolean,
  errors: array(fieldMessage),
  warnings: array(fieldMessage),
  derived: nullable(derived),
})

/* ------------------------------------------------------------------ simulations */

const simulationError: Parser<SimulationError> = object<SimulationError>({
  code: string,
  phase: string,
  message: string,
})

export const parseSimulationStatus: Parser<SimulationStatusDoc> = refine(
  object<SimulationStatusDoc>({
    id,
    experiment_id: id,
    experiment_version: integer,
    configuration_hash: hash,
    status: backendStatus,
    phase: literal(PHASES),
    stage: literal(STAGES),
    progress: fraction,
    measurements_completed: nonNegativeInteger,
    measurements_total: nonNegativeInteger,
    running_snr: nullable(nonNegative),
    playback: literal(PLAYBACKS),
    created_at: string,
    updated_at: string,
    completed_at: nullable(string),
    error: nullable(simulationError),
    results_available: boolean,
    last_seq: nonNegativeInteger,
  }),
  (s) => {
    if (s.measurements_completed > s.measurements_total) return 'measurements_completed exceeds measurements_total'
    if (s.status === 'failed' && s.error === null) return 'failed simulation without an error'
    if (s.results_available && s.status !== 'completed') return 'results available before completion'
    return null
  },
)

export const parseSimulationList: Parser<SimulationStatusDoc[]> = (value, path) =>
  object({ items: array(parseSimulationStatus) })(value, path).items

export const parsePlan: Parser<SurveyPlan> = refine(
  object<SurveyPlan>({
    simulation_id: nullable(id),
    pattern: literal(SCAN_PATTERNS),
    nx: nonNegativeInteger,
    ny: nonNegativeInteger,
    point_count: nonNegativeInteger,
    duration_s: nonNegative,
    sensor_mode: literal(SENSOR_MODES),
    reference: nullable(object({ x_m: finite, y_m: finite, z_m: finite })),
    bounds: object({ width_m: positive, length_m: positive }),
    sensor_height_m: positive,
    path: object({ x_m: finiteArray, y_m: finiteArray, z_m: finiteArray }),
    terrain: object({ x_m: finiteArray, y_m: finiteArray, elevation_m: array(finiteArray) }),
    bodies: array(
      object({
        id: string,
        anomaly_type: literal(ANOMALY_TYPES),
        geometry: literal(GEOMETRIES),
        mass_kg: finite,
        x_m: finite,
        y_m: finite,
        depth_m: positive,
        size_x_m: positive,
        size_y_m: positive,
        size_z_m: positive,
      }),
    ),
  }),
  (p) => {
    const n = p.point_count
    if (p.path.x_m.length !== n || p.path.y_m.length !== n || p.path.z_m.length !== n) {
      return 'path length does not match point_count'
    }
    if (p.terrain.elevation_m.length !== p.terrain.y_m.length) return 'terrain rows do not match y axis'
    if (p.terrain.elevation_m.some((row) => row.length !== p.terrain.x_m.length)) {
      return 'terrain columns do not match x axis'
    }
    return null
  },
)

/* ------------------------------------------------------------------ measurements */

const NULLABLE_FIELDS = new Set(['z_score'])

/**
 * Parses columnar measurements. Structural problems reject the whole batch; individual rows
 * with non-finite values are dropped and counted so one malformed measurement cannot poison
 * a chart.
 */
export function parseMeasurementColumns(value: unknown, startIndex: number, path: string): MeasurementBatch {
  if (!isRecord(value)) throw new ParseError(path, 'expected measurement columns')
  const columns: Record<string, unknown[]> = {}
  let length: number | null = null
  for (const field of MEASUREMENT_FIELDS) {
    const col = value[field]
    if (!Array.isArray(col)) throw new ParseError(`${path}.${field}`, 'expected an array')
    if (length === null) length = col.length
    else if (col.length !== length) throw new ParseError(`${path}.${field}`, 'column length mismatch')
    columns[field] = col
  }
  const rows: MeasurementRow[] = []
  let rejected = 0
  const n = length ?? 0
  for (let i = 0; i < n; i += 1) {
    const row: Record<string, number | null> = {}
    let ok = true
    for (const field of MEASUREMENT_FIELDS) {
      const v = columns[field]?.[i]
      if (typeof v === 'number' && Number.isFinite(v)) {
        row[field] = v
      } else if (v === null && NULLABLE_FIELDS.has(field)) {
        row[field] = null
      } else {
        ok = false
        break
      }
    }
    if (ok && Number.isInteger(row.index) && (row.index ?? -1) >= 0) rows.push(row as MeasurementRow)
    else rejected += 1
  }
  return { startIndex, rows, rejected }
}

/** Parses the single-measurement event form used by the engine for one-point updates. */
export function parseSingleMeasurement(value: unknown, path: string): MeasurementBatch {
  if (!isRecord(value)) throw new ParseError(path, 'expected a measurement object')
  const position = value.position
  if (!isRecord(position)) throw new ParseError(`${path}.position`, 'expected a position object')
  const columns: Record<string, unknown[]> = {}
  for (const field of MEASUREMENT_FIELDS) {
    const source =
      field === 'x_m' ? position.x : field === 'y_m' ? position.y : field === 'z_m' ? position.z : value[field]
    columns[field] = [source]
  }
  const index = value.index
  return parseMeasurementColumns(columns, typeof index === 'number' ? index : -1, path)
}

export function parseMeasurementPage(value: unknown, path: string) {
  const meta = object({
    simulation_id: id,
    status: backendStatus,
    start_index: nonNegativeInteger,
    count: nonNegativeInteger,
    available: nonNegativeInteger,
    total: nonNegativeInteger,
  })(value, path)
  const cols = isRecord(value) ? value.columns : undefined
  const batch =
    cols === null || cols === undefined
      ? { startIndex: meta.start_index, rows: [], rejected: 0 }
      : parseMeasurementColumns(cols, meta.start_index, `${path}.columns`)
  if (batch.rows.length + batch.rejected !== meta.count) {
    throw new ParseError(path, 'measurement count does not match columns')
  }
  return { ...meta, batch }
}

/* ------------------------------------------------------------------ results */

const envelopeShape = {
  simulation_id: id,
  experiment_id: id,
  experiment_version: integer,
  configuration_hash: hash,
  status: backendStatus,
  completed_at: nullable(string),
}

function completedEnvelope(value: unknown, path: string): ResultEnvelope {
  const env = object<ResultEnvelope>(envelopeShape)(value, path)
  if (env.status !== 'completed') throw new ParseError(`${path}.status`, 'results must belong to a completed simulation')
  return env
}

const estimate: Parser<Estimate> = object<Estimate>({ estimate: finite, std_error: nullable(nonNegative) })

const summary: Parser<ResultSummary> = object<ResultSummary>({
  anomaly_detected: boolean,
  detection_description: string,
  detection_significance_sigma: nullable(nonNegative),
  primary_source: object({
    id: string,
    mass_kg: finite,
    x_m: finite,
    y_m: finite,
    depth_m: finite,
    depth_ci_low: nullable(finite),
    depth_ci_high: nullable(finite),
    mass_ci_low: nullable(finite),
    mass_ci_high: nullable(finite),
    mass_significance_sigma: nullable(nonNegative),
  }),
  peak_observed_deviation: nonNegative,
  measurement_count: nonNegativeInteger,
})
export const parseSummary = summary

const noiseComponent: Parser<NoiseComponent> = object<NoiseComponent>({
  id: string,
  label: string,
  sigma: nonNegative,
  kind: literal(NOISE_KINDS),
  description: string,
})

const truthBody: Parser<TruthBody> = object<TruthBody>({
  id: string,
  anomaly_type: literal(ANOMALY_TYPES),
  geometry: literal(GEOMETRIES),
  mass_kg: finite,
  density_contrast_kg_m3: finite,
  x_m: finite,
  y_m: finite,
  depth_m: positive,
  top_depth_m: finite,
  size_x_m: positive,
  size_y_m: positive,
  size_z_m: positive,
})

const ciFlag = nullable(boolean)

const comparison: Parser<Comparison> = object<Comparison>({
  matching: string,
  matches: array(
    object({
      truth_id: string,
      source_id: string,
      depth_error_m: finite,
      mass_error_percent: finite,
      mass_error_kg: finite,
      x_error_m: finite,
      y_error_m: finite,
      horizontal_error_m: nonNegative,
      location_error_m: nonNegative,
      truth_within_ci: object({ mass_kg: ciFlag, x_m: ciFlag, y_m: ciFlag, depth_m: ciFlag }),
    }),
  ),
  unmatched_truth_ids: array(string),
  unmatched_source_ids: array(string),
  field_rmse_fractional: nonNegative,
  field_rmse_relative: nullable(nonNegative),
  gravity_rmse_m_s2: nonNegative,
  signal_amplitude_fractional: nonNegative,
  noise_rms_fractional: nonNegative,
  snr: nullable(nonNegative),
  snr_definition: string,
})

export const parseResults: Parser<Results> = (value, path) => {
  const env = completedEnvelope(value, path)
  const rest = object({
    summary,
    noise_budget: object({
      components: array(noiseComponent),
      white_sigma: nonNegative,
      environmental_sigma: nonNegative,
      nominal_sigma: nonNegative,
    }),
    comparison,
    ground_truth: object({ bodies: array(truthBody) }),
  })(value, path)
  return { ...env, ...rest }
}

function section<T>(data: Parser<T>): Parser<ResultEnvelope & { data: T }> {
  return (value, path) => {
    const env = completedEnvelope(value, path)
    const inner = isRecord(value) ? value.data : undefined
    return { ...env, data: data(inner, `${path}.data`) }
  }
}

const sourceEstimate: Parser<SourceEstimate> = object<SourceEstimate>({
  id: string,
  mass_kg: estimate,
  x_m: estimate,
  y_m: estimate,
  depth_m: estimate,
  mass_significance_sigma: nullable(nonNegative),
})

export const parseInversionDoc: Parser<InversionDoc> = object<InversionDoc>({
    model: string,
    source_count: nonNegativeInteger,
    sources: array(sourceEstimate),
    offset: estimate,
    drift_per_s: estimate,
    fit: object({
      converged: boolean,
      message: string,
      evaluations: nonNegativeInteger,
      n_points: nonNegativeInteger,
      n_parameters: nonNegativeInteger,
      residual_rms: nonNegative,
      reduced_chi_square: nullable(nonNegative),
      covariance_available: boolean,
      min_depth_m: positive,
    }),
    detection: object({
      criterion_sigma: positive,
      method: string,
      description: string,
      anomaly_detected: boolean,
      significance_sigma: nullable(nonNegative),
      delta_chi_square: nullable(nonNegative),
      effective_trials: nullable(positive),
      null_samples: nonNegativeInteger,
      null_exceedance: nullable(fraction),
    }),
  })

export const parseInversion = section<InversionDoc>(parseInversionDoc)

const histogram = refine(
  object({ bin_edges: finiteArray, counts: array(nonNegativeInteger) }),
  (h) => (h.bin_edges.length === h.counts.length + 1 ? null : 'histogram edges must be counts + 1'),
)

const parameterUncertainty: Parser<ParameterUncertainty> = refine(
  object<ParameterUncertainty>({
    unit: string,
    estimate: finite,
    std_error: nullable(nonNegative),
    bootstrap_std: nullable(nonNegative),
    ci_low: nullable(finite),
    ci_high: nullable(finite),
    histogram: nullable(histogram),
  }),
  (p) => {
    if ((p.ci_low === null) !== (p.ci_high === null)) return 'confidence interval must have both bounds'
    if (p.ci_low !== null && p.ci_high !== null && p.ci_low > p.ci_high) return 'confidence interval bounds reversed'
    return null
  },
)

export const parseUncertaintyDoc: Parser<UncertaintyDoc> = object<UncertaintyDoc>({
    method: string,
    confidence_level: fraction,
    requested_samples: nonNegativeInteger,
    samples_used: nonNegativeInteger,
    converged_samples: nonNegativeInteger,
    block_length: nonNegativeInteger,
    capped: boolean,
    sources: array(
      object({ source_id: string, parameters: record(UNCERTAINTY_PARAMETERS, parameterUncertainty) }),
    ),
  })

export const parseUncertainty = section<UncertaintyDoc>(parseUncertaintyDoc)

export const parseAnomalyMap = section<AnomalyMapDoc>((value, path) => {
  const base = object({
    available: boolean,
    unavailable_reason: nullable(string),
    nx: nonNegativeInteger,
    ny: nonNegativeInteger,
    x_m: finiteArray,
    y_m: finiteArray,
  })(value, path)
  const raw = isRecord(value) ? value : {}
  if (!base.available) {
    if (base.unavailable_reason === null) throw new ParseError(path, 'unavailable map without a reason')
    return { ...base, layers: null, measurement_index: null }
  }
  if (base.x_m.length !== base.nx || base.y_m.length !== base.ny) throw new ParseError(path, 'axis length mismatch')
  const grid = matrix(base.ny, base.nx)
  const layers = record(MAP_LAYERS, grid)(raw.layers, `${path}.layers`)
  const measurementIndex = grid(raw.measurement_index, `${path}.measurement_index`)
  return { ...base, layers, measurement_index: measurementIndex }
})

export const parseSignals = section<SignalsDoc>(
  refine(
    object<SignalsDoc>({
      index: finiteArray,
      filtered: finiteArray,
      drift_corrected: finiteArray,
      residual: finiteArray,
      model_prediction: finiteArray,
      estimated_gravity_anomaly_m_s2: finiteArray,
      filter_description: string,
    }),
    (s) => {
      const n = s.index.length
      const same = [s.filtered, s.drift_corrected, s.residual, s.model_prediction, s.estimated_gravity_anomaly_m_s2]
      return same.every((a) => a.length === n) ? null : 'signal arrays differ in length'
    },
  ),
)

export { simulationError as parseSimulationError }
