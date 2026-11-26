import rawLimits from '../../../../contract/config-limits.json'
import rawPresets from '../../../../contract/clock-presets.json'
import { array, boolean, finite, literal, object, record, string } from '../../api/parse'
import type { Parser } from '../../api/parse'
import { parseClockPreset } from '../../api/schemas'
import type { ClockPerformance, ClockPreset, NamedPerformanceClass, PerformanceClassInfo, PerformanceClass, ClockSpecies } from '../../types/config'

/** Field limits shared with the engine (single source of truth: /contract). */
export interface FieldSpec {
  label: string
  unit: string
  min: number
  max: number
  positive: boolean
  integer: boolean
}

const optionalBoolean: Parser<boolean> = (value, path) => (value === undefined ? false : boolean(value, path))

const fieldSpec: Parser<FieldSpec> = object<FieldSpec>({
  label: string,
  unit: string,
  min: finite,
  max: finite,
  positive: optionalBoolean,
  integer: optionalBoolean,
})

export const FIELD_PATHS = [
  'environment.latitude_deg',
  'environment.longitude_deg',
  'environment.elevation_m',
  'environment.terrain_relief_m',
  'environment.terrain_density_kg_m3',
  'environment.terrain_density_assumed_kg_m3',
  'bodies.*.density_contrast_kg_m3',
  'bodies.*.mass_kg',
  'bodies.*.depth_m',
  'bodies.*.x_m',
  'bodies.*.y_m',
  'sensor.reference_frequency_hz',
  'sensor.bbr_sensitivity_per_k',
  'sensor.measurement_interval_s',
  'sensor.stability_1s',
  'sensor.systematic_uncertainty',
  'sensor.uptime_percent',
  'sensor.reference_distance_km',
  'noise.measurement_noise',
  'noise.frequency_drift_per_hour',
  'noise.environmental_noise',
  'noise.temperature_fluctuation_k',
  'noise.vibration_m',
  'noise.station_height_uncertainty_m',
  'noise.tide_residual_percent',
  'noise.seed',
  'survey.width_m',
  'survey.length_m',
  'survey.spacing_m',
  'survey.sensor_height_m',
  'survey.setup_time_s',
  'inversion.source_count',
  'inversion.bootstrap_samples',
] as const
export type FieldPath = (typeof FIELD_PATHS)[number]

const parsed = object({
  fields: record(FIELD_PATHS, fieldSpec),
  bodies: object({ min_count: finite, max_count: finite }),
  survey: object({ max_points: finite, min_points_per_axis: finite }),
  name: object({ max_length: finite }),
})(rawLimits, 'config-limits')

export const FIELD_SPECS: Readonly<Record<FieldPath, FieldSpec>> = parsed.fields
export const BODY_LIMITS = parsed.bodies
export const SURVEY_LIMITS = parsed.survey
export const NAME_MAX_LENGTH = parsed.name.max_length

const presetFile = object({
  note: string,
  performance_note: string,
  performance_classes: array(
    object<PerformanceClassInfo>({ id: literal(['field', 'laboratory', 'projected'] as const), label: string, description: string }),
  ),
  presets: array(parseClockPreset),
})(rawPresets, 'clock-presets')

/** Validity range of the engine's analytical Sun and Moon ephemerides (same as the engine check). */
export const START_DATE_RANGE = { min: '2000-01-01', max: '2100-12-31' } as const

export const CLOCK_PRESETS: readonly ClockPreset[] = presetFile.presets
export const PRESET_NOTE: string = presetFile.note
export const PERFORMANCE_NOTE: string = presetFile.performance_note
export const PERFORMANCE_CLASSES_INFO: readonly PerformanceClassInfo[] = presetFile.performance_classes

/** Published performance of a species in a named class; null for custom clocks or custom performance. */
export function performanceFor(species: ClockSpecies, performanceClass: PerformanceClass): ClockPerformance | null {
  if (performanceClass === 'custom') return null
  const preset = CLOCK_PRESETS.find((p) => p.id === species)
  return preset ? preset.performance[performanceClass satisfies NamedPerformanceClass] : null
}
