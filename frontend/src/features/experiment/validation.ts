/*
 * Client-side configuration validation. Mirrors engine/validation.py (same rules, same
 * wording) so invalid values are caught instantly and never sent to the engine.
 */
import type { ExperimentConfig } from '../../types/config'
import { MINUS, superscript } from '../../utils/format'
import type { FieldPath, FieldSpec } from './limits'
import { BODY_LIMITS, CLOCK_PRESETS, FIELD_SPECS, NAME_MAX_LENGTH, START_DATE_RANGE, SURVEY_LIMITS, performanceFor } from './limits'
import { axisCount, bodyExtent, extentsOverlap, terrainMinElevation } from './geometry'
import type { BodyExtent } from './geometry'

export type FieldErrors = Record<string, string>

/** Values fixed by a named performance class (same labels as the engine's messages). */
const PERFORMANCE_FIELDS = [
  ['stability_1s', 'Sensor stability'],
  ['systematic_uncertainty', 'Systematic uncertainty'],
  ['uptime_percent', 'Clock uptime'],
] as const

/** Number formatting used in messages; matches the engine's format_limit(). */
export function formatLimit(value: number): string {
  if (value === 0) return '0'
  const magnitude = Math.abs(value)
  if (magnitude >= 1e5 || magnitude < 1e-3) {
    const exponent = Math.floor(Math.log10(magnitude))
    const mantissa = Number((value / 10 ** exponent).toPrecision(3)).toString()
    const exp = superscript(exponent)
    if (mantissa === '1') return `10${exp}`
    if (mantissa === '-1') return `${MINUS}10${exp}`
    return `${mantissa.replace('-', MINUS)} × 10${exp}`
  }
  return Number(value.toPrecision(6)).toString().replace('-', MINUS)
}

export function withUnit(text: string, unit: string): string {
  if (!unit) return text
  if (unit === '°') return `${text}°`
  return `${text} ${unit}`
}

export function specFor(path: string): FieldSpec | null {
  const parts = path.split('.')
  const key = parts[0] === 'bodies' && parts.length === 3 ? `bodies.*.${parts[2] ?? ''}` : path
  return (FIELD_SPECS as Record<string, FieldSpec | undefined>)[key] ?? null
}

/** Range message for one value, or null when valid. */
export function checkValue(spec: FieldSpec, value: number): string | null {
  const { label, unit } = spec
  if (!Number.isFinite(value)) return `${label} must be a finite number.`
  if (spec.integer && !Number.isInteger(value)) return `${label} must be a whole number.`
  if (spec.positive && value <= 0) return `${label} must be greater than ${withUnit('0', unit)}.`
  if (value < spec.min) return `${label} must be at least ${withUnit(formatLimit(spec.min), unit)}.`
  if (value > spec.max) return `${label} must be at most ${withUnit(formatLimit(spec.max), unit)}.`
  return null
}

function check(errors: FieldErrors, path: string, spec: FieldSpec, value: number): boolean {
  const message = checkValue(spec, value)
  if (message !== null) errors[path] = message
  return message === null
}

function minimumSpacing(width: number, length: number | null, maxPoints: number): number {
  let spacing = length !== null ? Math.sqrt((width * length) / maxPoints) : width / (maxPoints - 1)
  spacing = Math.max(spacing, 1)
  for (;;) {
    const count = axisCount(width, spacing) * (length !== null ? axisCount(length, spacing) : 1)
    if (count <= maxPoints) return Math.ceil(spacing * 10) / 10
    spacing *= 1.01
  }
}

export function validateConfig(config: ExperimentConfig): FieldErrors {
  const errors: FieldErrors = {}
  const spec = (path: FieldPath) => FIELD_SPECS[path]

  if (config.name.trim() === '') errors.name = 'Experiment name is required.'
  else if (config.name.length > NAME_MAX_LENGTH) errors.name = `Experiment name must be at most ${NAME_MAX_LENGTH} characters.`

  const env = config.environment
  check(errors, 'environment.latitude_deg', spec('environment.latitude_deg'), env.latitude_deg)
  check(errors, 'environment.longitude_deg', spec('environment.longitude_deg'), env.longitude_deg)
  check(errors, 'environment.elevation_m', spec('environment.elevation_m'), env.elevation_m)
  const reliefOk = check(errors, 'environment.terrain_relief_m', spec('environment.terrain_relief_m'), env.terrain_relief_m)
  check(errors, 'environment.terrain_density_kg_m3', spec('environment.terrain_density_kg_m3'), env.terrain_density_kg_m3)
  check(errors, 'environment.terrain_density_assumed_kg_m3', spec('environment.terrain_density_assumed_kg_m3'), env.terrain_density_assumed_kg_m3)

  if (config.bodies.length < BODY_LIMITS.min_count || config.bodies.length > BODY_LIMITS.max_count) {
    errors.bodies = `Define between ${BODY_LIMITS.min_count} and ${BODY_LIMITS.max_count} subsurface bodies.`
  }
  if (new Set(config.bodies.map((b) => b.id)).size !== config.bodies.length) {
    errors.bodies = 'Subsurface body identifiers must be unique.'
  }

  let bodiesOk = true
  for (const [i, body] of config.bodies.entries()) {
    bodiesOk = check(errors, `bodies.${i}.density_contrast_kg_m3`, spec('bodies.*.density_contrast_kg_m3'), body.density_contrast_kg_m3) && bodiesOk
    bodiesOk = check(errors, `bodies.${i}.mass_kg`, spec('bodies.*.mass_kg'), body.mass_kg) && bodiesOk
    bodiesOk = check(errors, `bodies.${i}.depth_m`, spec('bodies.*.depth_m'), body.depth_m) && bodiesOk
    bodiesOk = check(errors, `bodies.${i}.x_m`, spec('bodies.*.x_m'), body.x_m) && bodiesOk
    bodiesOk = check(errors, `bodies.${i}.y_m`, spec('bodies.*.y_m'), body.y_m) && bodiesOk
  }

  if (bodiesOk && reliefOk) {
    const groundLow = terrainMinElevation(env.terrain, env.terrain_relief_m)
    const extents: BodyExtent[] = []
    config.bodies.forEach((body, i) => {
      const extent = bodyExtent(body)
      if (extent === null) return
      extents.push(extent)
      if (extent.zCenter + extent.halfZ >= groundLow) {
        const required = Math.round((extent.halfZ - groundLow) * 10) / 10
        errors[`bodies.${i}.depth_m`] =
          `Body extends above the ground surface. Increase depth beyond ${withUnit(formatLimit(required), 'm')} or reduce the mass.`
      }
    })
    for (let i = 0; i < extents.length; i += 1) {
      for (let j = i + 1; j < extents.length; j += 1) {
        const a = extents[i]
        const b = extents[j]
        if (a && b && extentsOverlap(a, b)) errors[`bodies.${j}`] = `Body ${j + 1} overlaps body ${i + 1}. Move or resize one of them.`
      }
    }
  }

  const sensor = config.sensor
  check(errors, 'sensor.reference_frequency_hz', spec('sensor.reference_frequency_hz'), sensor.reference_frequency_hz)
  check(errors, 'sensor.bbr_sensitivity_per_k', spec('sensor.bbr_sensitivity_per_k'), sensor.bbr_sensitivity_per_k)
  check(errors, 'sensor.measurement_interval_s', spec('sensor.measurement_interval_s'), sensor.measurement_interval_s)
  check(errors, 'sensor.stability_1s', spec('sensor.stability_1s'), sensor.stability_1s)
  check(errors, 'sensor.systematic_uncertainty', spec('sensor.systematic_uncertainty'), sensor.systematic_uncertainty)
  check(errors, 'sensor.uptime_percent', spec('sensor.uptime_percent'), sensor.uptime_percent)
  check(errors, 'sensor.reference_distance_km', spec('sensor.reference_distance_km'), sensor.reference_distance_km)
  if (sensor.performance_class !== 'custom') {
    const values = performanceFor(sensor.clock_species, sensor.performance_class)
    if (sensor.clock_species === 'custom') {
      errors['sensor.performance_class'] = 'A custom clock needs custom performance values. Choose “Custom”.'
    } else if (values === null) {
      errors['sensor.performance_class'] = 'Unknown performance class for this clock species.'
    } else {
      for (const [name, label] of PERFORMANCE_FIELDS) {
        const value = sensor[name]
        if (Number.isFinite(value) && Math.abs(value - values[name]) > 1e-9 * Math.abs(values[name])) {
          errors[`sensor.${name}`] = `${label} must match the selected performance class. Choose “Custom” performance to set it manually.`
        }
      }
    }
  }
  if (sensor.clock_species !== 'custom') {
    const preset = CLOCK_PRESETS.find((p) => p.id === sensor.clock_species)
    if (preset === undefined) {
      errors['sensor.clock_species'] = 'Unknown clock species.'
    } else {
      if (Number.isFinite(sensor.reference_frequency_hz) && Math.abs(sensor.reference_frequency_hz - preset.reference_frequency_hz) > 1e-12 * preset.reference_frequency_hz) {
        errors['sensor.reference_frequency_hz'] = 'Reference frequency must match the selected clock species. Choose “Custom” to set it manually.'
      }
      if (Number.isFinite(sensor.bbr_sensitivity_per_k) && Math.abs(sensor.bbr_sensitivity_per_k - preset.bbr_sensitivity_per_k) > 1e-9 * Math.max(preset.bbr_sensitivity_per_k, 1e-30)) {
        errors['sensor.bbr_sensitivity_per_k'] = 'Blackbody sensitivity must match the selected clock species. Choose “Custom” to set it manually.'
      }
    }
  }

  const noise = config.noise
  check(errors, 'noise.measurement_noise', spec('noise.measurement_noise'), noise.measurement_noise)
  check(errors, 'noise.frequency_drift_per_hour', spec('noise.frequency_drift_per_hour'), noise.frequency_drift_per_hour)
  check(errors, 'noise.environmental_noise', spec('noise.environmental_noise'), noise.environmental_noise)
  check(errors, 'noise.temperature_fluctuation_k', spec('noise.temperature_fluctuation_k'), noise.temperature_fluctuation_k)
  check(errors, 'noise.vibration_m', spec('noise.vibration_m'), noise.vibration_m)
  check(errors, 'noise.station_height_uncertainty_m', spec('noise.station_height_uncertainty_m'), noise.station_height_uncertainty_m)
  check(errors, 'noise.tide_residual_percent', spec('noise.tide_residual_percent'), noise.tide_residual_percent)
  check(errors, 'noise.seed', spec('noise.seed'), noise.seed)

  const survey = config.survey
  let surveyOk = check(errors, 'survey.width_m', spec('survey.width_m'), survey.width_m)
  surveyOk = check(errors, 'survey.length_m', spec('survey.length_m'), survey.length_m) && surveyOk
  surveyOk = check(errors, 'survey.spacing_m', spec('survey.spacing_m'), survey.spacing_m) && surveyOk
  surveyOk = check(errors, 'survey.sensor_height_m', spec('survey.sensor_height_m'), survey.sensor_height_m) && surveyOk
  check(errors, 'survey.setup_time_s', spec('survey.setup_time_s'), survey.setup_time_s)
  // ISO dates compare correctly as strings; the pattern check also rejects incomplete input.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(survey.start_date) || survey.start_date < START_DATE_RANGE.min || survey.start_date > START_DATE_RANGE.max) {
    errors['survey.start_date'] = `Start date must be between ${START_DATE_RANGE.min} and ${START_DATE_RANGE.max}.`
  }
  if (surveyOk) {
    const minAxis = SURVEY_LIMITS.min_points_per_axis
    const nx = axisCount(survey.width_m, survey.spacing_m)
    const ny = survey.pattern === 'profile' ? 1 : axisCount(survey.length_m, survey.spacing_m)
    if (nx < minAxis) {
      errors['survey.spacing_m'] =
        `Resolution is too coarse: at least ${minAxis} points are needed across the survey width. Use a spacing of at most ${withUnit(formatLimit(survey.width_m / (minAxis - 1)), 'm')}.`
    } else if (survey.pattern !== 'profile' && ny < minAxis) {
      errors['survey.spacing_m'] =
        `Resolution is too coarse: at least ${minAxis} points are needed along the survey length. Use a spacing of at most ${withUnit(formatLimit(survey.length_m / (minAxis - 1)), 'm')}.`
    } else if (nx * ny > SURVEY_LIMITS.max_points) {
      const minimum = minimumSpacing(survey.width_m, survey.pattern === 'profile' ? null : survey.length_m, SURVEY_LIMITS.max_points)
      const group = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ')
      errors['survey.spacing_m'] =
        `Survey would contain ${group(nx * ny)} measurement points; the maximum is ${group(SURVEY_LIMITS.max_points)}. Use a spacing of at least ${withUnit(formatLimit(minimum), 'm')}.`
    }
  }

  check(errors, 'inversion.source_count', spec('inversion.source_count'), config.inversion.source_count)
  check(errors, 'inversion.bootstrap_samples', spec('inversion.bootstrap_samples'), config.inversion.bootstrap_samples)
  return errors
}

export const SECTION_PREFIXES = {
  environment: ['environment.'],
  subsurface: ['bodies'],
  sensor: ['sensor.'],
  noise: ['noise'],
  survey: ['survey.'],
  inversion: ['inversion.'],
} as const
export type SectionId = keyof typeof SECTION_PREFIXES

export function sectionErrorCount(errors: FieldErrors, section: SectionId): number {
  const prefixes: readonly string[] = SECTION_PREFIXES[section]
  return Object.keys(errors).filter((path) => prefixes.some((p) => path.startsWith(p))).length
}
