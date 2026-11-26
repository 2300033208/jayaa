/*
 * Experiment configuration. Property names match the engine wire format (snake_case)
 * so field paths in validation errors, exports and the UI share one vocabulary.
 */

export const EARTH_MODELS = ['wgs84', 'spherical'] as const
export const TERRAINS = ['flat', 'slope', 'hills', 'dem'] as const
export const TIDES = ['off', 'modelled'] as const
export const ANOMALY_TYPES = ['dense', 'cavity'] as const
export const GEOMETRIES = ['sphere', 'cube', 'slab'] as const
export const SENSOR_MODES = ['local_reference', 'remote_reference'] as const
export const CLOCK_SPECIES = ['sr', 'yb', 'al_ion', 'cs', 'custom'] as const
export const PERFORMANCE_CLASSES = ['field', 'laboratory', 'projected', 'custom'] as const
export const SCAN_PATTERNS = ['serpentine', 'raster', 'profile'] as const
export const PLAYBACKS = ['normal', 'fast', 'instant'] as const

export type EarthModel = (typeof EARTH_MODELS)[number]
export type Terrain = (typeof TERRAINS)[number]
export type Tides = (typeof TIDES)[number]
export type AnomalyType = (typeof ANOMALY_TYPES)[number]
export type Geometry = (typeof GEOMETRIES)[number]
export type SensorMode = (typeof SENSOR_MODES)[number]
export type ClockSpecies = (typeof CLOCK_SPECIES)[number]
export type PerformanceClass = (typeof PERFORMANCE_CLASSES)[number]
export type ScanPattern = (typeof SCAN_PATTERNS)[number]
export type Playback = (typeof PLAYBACKS)[number]

export interface EnvironmentConfig {
  earth_model: EarthModel
  latitude_deg: number
  longitude_deg: number
  elevation_m: number
  terrain: Terrain
  /** Synthetic terrains only. */
  terrain_relief_m: number
  /** Uploaded elevation model, used with the 'dem' terrain (null otherwise). */
  terrain_model_id: string | null
  /** True rock density of the terrain; 0 leaves terrain mass out. */
  terrain_density_kg_m3: number
  /** Density the analyst assumes in the terrain correction. */
  terrain_density_assumed_kg_m3: number
  tides: Tides
}

export interface BodyConfig {
  id: string
  anomaly_type: AnomalyType
  geometry: Geometry
  density_contrast_kg_m3: number
  mass_kg: number
  depth_m: number
  x_m: number
  y_m: number
}

export interface SensorConfig {
  mode: SensorMode
  clock_species: ClockSpecies
  performance_class: PerformanceClass
  reference_frequency_hz: number
  bbr_sensitivity_per_k: number
  /** Clock-comparison averaging time per station (clock running). */
  measurement_interval_s: number
  stability_1s: number
  /** Residual systematic shift incurred at every station set-up (fractional frequency). */
  systematic_uncertainty: number
  uptime_percent: number
  /** Remote reference only: distance (due north) to the reference clock. */
  reference_distance_km: number
}

export interface NoiseConfig {
  measurement_noise: number
  frequency_drift_per_hour: number
  environmental_noise: number
  temperature_fluctuation_k: number
  vibration_m: number
  station_height_uncertainty_m: number
  /** Unmodelled ocean and atmospheric loading, as a percentage of the solid-Earth tide. */
  tide_residual_percent: number
  seed: number
}

export interface SurveyConfig {
  width_m: number
  length_m: number
  spacing_m: number
  sensor_height_m: number
  setup_time_s: number
  /** UTC start date of the campaign (YYYY-MM-DD); sets the tides. */
  start_date: string
  pattern: ScanPattern
}

export interface InversionConfig {
  source_count: number
  bootstrap_samples: number
}

export interface ExperimentConfig {
  name: string
  environment: EnvironmentConfig
  bodies: BodyConfig[]
  sensor: SensorConfig
  noise: NoiseConfig
  survey: SurveyConfig
  inversion: InversionConfig
}

export type NamedPerformanceClass = Exclude<PerformanceClass, 'custom'>

export interface ClockPerformance {
  stability_1s: number
  systematic_uncertainty: number
  uptime_percent: number
  /** Literature basis or stated assumption behind the values. */
  basis: string
}

export interface ClockPreset {
  id: Exclude<ClockSpecies, 'custom'>
  label: string
  reference_frequency_hz: number
  bbr_sensitivity_per_k: number
  performance: Record<NamedPerformanceClass, ClockPerformance>
}

export interface PerformanceClassInfo {
  id: NamedPerformanceClass
  label: string
  description: string
}
