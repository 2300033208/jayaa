import { describe, expect, it } from 'vitest'
import defaults from '../../../../contract/default-config.json'
import scenarios from '../../../../contract/scenarios.json'
import { parseConfig } from '../../api/schemas'
import type { ExperimentConfig } from '../../types/config'
import { formatLimit, validateConfig } from './validation'

/** Rule tests use a fixed scenario (as the engine tests do), not the product default, which may change. */
function scenario(id: string): ExperimentConfig {
  const found = scenarios.scenarios.find((s) => s.id === id)
  if (found === undefined) throw new Error(`no scenario ${id}`)
  return parseConfig(structuredClone(found.config), id)
}

function config(): ExperimentConfig {
  return scenario('ore-projected')
}

function firstBody(c: ExperimentConfig) {
  const body = c.bodies[0]
  if (body === undefined) throw new Error('default config has no body')
  return body
}

describe('configuration validation (mirrors the engine)', () => {
  it('accepts the shared default configuration and every research scenario', () => {
    expect(validateConfig(parseConfig(structuredClone(defaults), 'defaults'))).toEqual({})
    for (const s of scenarios.scenarios) expect(validateConfig(scenario(s.id))).toEqual({})
  })

  it('fixes stability, systematic uncertainty and uptime to the selected performance class', () => {
    const c = scenario('ore-field')
    c.sensor.stability_1s = 1e-16
    c.sensor.uptime_percent = 80
    const errors = validateConfig(c)
    expect(errors['sensor.stability_1s']).toBe('Sensor stability must match the selected performance class. Choose “Custom” performance to set it manually.')
    expect(errors['sensor.uptime_percent']).toBe('Clock uptime must match the selected performance class. Choose “Custom” performance to set it manually.')
    c.sensor.performance_class = 'custom'
    expect(validateConfig(c)).toEqual({})
    c.sensor.clock_species = 'custom'
    c.sensor.performance_class = 'field'
    expect(validateConfig(c)['sensor.performance_class']).toBe('A custom clock needs custom performance values. Choose “Custom”.')
  })

  it('rejects invalid campaign logistics', () => {
    const c = config()
    c.sensor.performance_class = 'custom'
    c.sensor.uptime_percent = 0
    c.survey.setup_time_s = -1
    c.noise.station_height_uncertainty_m = Number.NaN
    const errors = validateConfig(c)
    expect(errors['sensor.uptime_percent']).toBe('Clock uptime must be greater than 0 %.')
    expect(errors['survey.setup_time_s']).toBe('Station set-up time must be at least 0 s.')
    expect(errors['noise.station_height_uncertainty_m']).toBe('Station height uncertainty must be a finite number.')
  })

  it('rejects invalid site settings', () => {
    const c = config()
    c.survey.start_date = '1999-12-31'
    c.noise.tide_residual_percent = 120
    c.environment.terrain_density_assumed_kg_m3 = -1
    c.sensor.reference_distance_km = 6000
    const errors = validateConfig(c)
    expect(errors['survey.start_date']).toBe('Start date must be between 2000-01-01 and 2100-12-31.')
    expect(errors['noise.tide_residual_percent']).toBe('Tide residual must be at most 100 %.')
    expect(errors['environment.terrain_density_assumed_kg_m3']).toBe('Assumed terrain density must be at least 0 kg/m³.')
    expect(errors['sensor.reference_distance_km']).toBe('Reference distance must be at most 5000 km.')
    c.survey.start_date = '2027-3-1'
    expect(validateConfig(c)['survey.start_date']).toBe('Start date must be between 2000-01-01 and 2100-12-31.')
  })

  it('reports exact field-level messages', () => {
    const c = config()
    firstBody(c).depth_m = -5
    firstBody(c).density_contrast_kg_m3 = 0
    const errors = validateConfig(c)
    expect(errors['bodies.0.depth_m']).toBe('Depth must be greater than 0 m.')
    expect(errors['bodies.0.density_contrast_kg_m3']).toBe('Density contrast must be greater than 0 kg/m³.')
  })

  it('rejects NaN and Infinity instead of coercing them', () => {
    const c = config()
    firstBody(c).mass_kg = Number.NaN
    c.survey.sensor_height_m = Number.POSITIVE_INFINITY
    const errors = validateConfig(c)
    expect(errors['bodies.0.mass_kg']).toBe('Mass must be a finite number.')
    expect(errors['survey.sensor_height_m']).toBe('Sensor height must be a finite number.')
  })

  it('rejects impossible geometry: a body above the ground', () => {
    const c = config()
    firstBody(c).depth_m = 500
    expect(validateConfig(c)['bodies.0.depth_m']).toMatch(/^Body extends above the ground surface\. Increase depth beyond 926\.7 m/)
  })

  it('rejects overlapping bodies', () => {
    const c = config()
    const body = firstBody(c)
    c.bodies.push({ ...body, id: 'body-2', x_m: body.x_m + 100 })
    expect(validateConfig(c)['bodies.1']).toBe('Body 2 overlaps body 1. Move or resize one of them.')
  })

  it('rejects invalid survey resolution', () => {
    const c = config()
    c.survey.spacing_m = 10
    expect(validateConfig(c)['survey.spacing_m']).toMatch(/maximum is 100 000/)
    c.survey.spacing_m = 5000
    expect(validateConfig(c)['survey.spacing_m']).toMatch(/^Resolution is too coarse/)
  })

  it('rejects invalid sensor height and frequency', () => {
    const c = config()
    c.survey.sensor_height_m = 0
    c.sensor.clock_species = 'custom'
    c.sensor.reference_frequency_hz = -1
    const errors = validateConfig(c)
    expect(errors['survey.sensor_height_m']).toBe('Sensor height must be greater than 0 m.')
    expect(errors['sensor.reference_frequency_hz']).toBe('Reference frequency must be greater than 0 Hz.')
  })

  it('requires preset frequencies to match the species', () => {
    const c = config()
    c.sensor.reference_frequency_hz = 4e14
    expect(validateConfig(c)['sensor.reference_frequency_hz']).toMatch(/must match the selected clock species/)
  })

  it('requires whole numbers for integer fields', () => {
    const c = config()
    c.noise.seed = 1.5
    expect(validateConfig(c)['noise.seed']).toBe('Random seed must be a whole number.')
  })

  it('requires a name', () => {
    const c = config()
    c.name = '   '
    expect(validateConfig(c).name).toBe('Experiment name is required.')
  })

  it('formats limits exactly like the engine', () => {
    expect(formatLimit(1e6)).toBe('10⁶')
    expect(formatLimit(2.5e-19)).toBe('2.5 × 10⁻¹⁹')
    expect(formatLimit(0.1)).toBe('0.1')
    expect(formatLimit(-90)).toBe('−90')
  })
})
