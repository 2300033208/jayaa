/*
 * Accounts, uploaded field datasets and elevation models (engine wire format, snake_case).
 */

import type { InversionDoc, UncertaintyDoc } from './api'
import type { Tides } from './config'

export interface User {
  id: string
  email: string
  display_name: string
  created_at: string
}

export interface AuthConfig {
  signup_allowed: boolean
  password_min_length: number
}

/* ------------------------------------------------------------------ field datasets */

export const DATASET_STATUSES = ['analysing', 'ready', 'failed', 'cancelled'] as const
export type DatasetStatus = (typeof DATASET_STATUSES)[number]

export const FIT_QUALITIES = ['consistent', 'scatter_exceeds_uncertainties', 'uncertainties_overstated', 'unknown'] as const
export type FitQuality = (typeof FIT_QUALITIES)[number]

export interface DatasetOptions {
  reference_x_m: number | null
  reference_y_m: number | null
  reference_height_m: number | null
}

export interface Dataset {
  id: string
  experiment_id: string
  name: string
  file_name: string
  file_sha256: string
  size_bytes: number
  measurement_count: number
  station_count: number
  start_utc: string
  end_utc: string
  has_averaging_column: boolean
  options: DatasetOptions
  status: DatasetStatus
  progress: number
  error: { code: string; message: string } | null
  summary: { anomaly_detected: boolean; detection_significance_sigma: number | null; fit_quality: FitQuality } | null
  analysed_at: string | null
  created_at: string
  updated_at: string
  /** Configuration the latest analysis used; differs from the experiment's after an edit. */
  configuration_hash: string | null
  experiment_version: number | null
}

/** One problem in an uploaded file, with its line (1 = header) and column when known. */
export interface FileProblem {
  line: number | null
  column: string | null
  message: string
}

export interface FieldSummary {
  anomaly_detected: boolean
  detection_significance_sigma: number | null
  detection_description: string
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
    mass_significance_sigma: number | null
  }
  measurement_count: number
  station_count: number
  median_uncertainty: number
  station_spacing_m: number
  reduced_chi_square: number | null
  fit_quality: FitQuality
  duration_s: number
}

export type ReferenceUsed =
  | { mode: 'local'; x_m: number; y_m: number; height_m: number }
  | { mode: 'remote'; distance_km: number }

export interface FieldCorrections {
  normal_rms: number
  terrain_rms: number
  tide_rms: number
  terrain_density_kg_m3: number
  tides: Tides
  reference: ReferenceUsed
}

export interface FieldHypothesis {
  description: string
  body_count: number
  chi_square_null: number
  chi_square_hypothesis: number
  chi_square_fit: number
  peak_signal: number
}

export const STATION_SERIES = [
  'x_m',
  'y_m',
  'height_m',
  'observed',
  'correction',
  'corrected',
  'drift_removed',
  'model',
  'residual',
  'uncertainty',
  'hypothesis',
  'gravity_anomaly_estimated_m_s2',
  'gravity_anomaly_hypothesis_m_s2',
] as const
export type StationSeries = (typeof STATION_SERIES)[number]

export type FieldStations = Record<StationSeries, number[]> & { station: string[]; time_utc: string[] }

export interface FieldResults {
  dataset: Dataset
  summary: FieldSummary
  inversion: InversionDoc
  uncertainty: UncertaintyDoc
  corrections: FieldCorrections
  hypothesis: FieldHypothesis
  stations: FieldStations
}

/* ------------------------------------------------------------------ elevation models */

export const TERRAIN_CRS = ['geographic', 'utm'] as const
export type TerrainCrs = (typeof TERRAIN_CRS)[number]

export interface TerrainModel {
  id: string
  name: string
  file_name: string
  file_sha256: string
  size_bytes: number
  created_at: string
  rows: number
  columns: number
  cell_size: number
  cell_unit: 'degree' | 'm'
  datum: string | null
  min_height_m: number
  max_height_m: number
  no_data_fraction: number
  extent: { x_min: number; x_max: number; y_min: number; y_max: number }
  georeference: {
    crs: TerrainCrs
    utm_zone: number | null
    hemisphere: 'north' | 'south' | null
    x0: number
    y0: number
    dx: number
    dy: number
  }
}

export interface TerrainModelDetail extends TerrainModel {
  used_by: string[]
}

export interface TerrainPreview {
  x: number[]
  y: number[]
  heights: (number | null)[][]
  crs: TerrainCrs
  utm_zone: number | null
  hemisphere: 'north' | 'south' | null
  step: number
}
