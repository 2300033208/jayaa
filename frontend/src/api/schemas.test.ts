import { describe, expect, it } from 'vitest'
import clockPresets from '../../../contract/clock-presets.json'
import defaults from '../../../contract/default-config.json'
import scenarios from '../../../contract/scenarios.json'
import { EXP_ID, SIM_ID, batchEvent, detectabilityJson, experimentJson, resultsJson as resultsJsonForKind, row, statusJson, summaryJson } from '../test/fixtures'
import { parseMessage } from './events'
import { ParseError } from './parse'
import { parseDefaults, parseDetectability, parseExperiment, parseMeasurementColumns, parseMeasurementPage, parseResults, parseSimulationStatus } from './schemas'

describe('API response validation', () => {
  it('accepts a well-formed experiment', () => {
    expect(parseExperiment(experimentJson(), 'r').id).toBe(EXP_ID)
  })

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['undefined', undefined],
    ['null', null],
    ['string', '1500'],
  ])('rejects %s where a finite number is required', (_, bad) => {
    const exp = experimentJson()
    ;(exp.config.bodies[0] as Record<string, unknown>).depth_m = bad
    expect(() => parseExperiment(exp, 'r')).toThrow(ParseError)
  })

  it('rejects unknown enum values and malformed identifiers', () => {
    expect(() => parseSimulationStatus(statusJson({ status: 'exploded' }), 'r')).toThrow(/expected one of/)
    expect(() => parseSimulationStatus(statusJson({ id: 'not-an-id' }), 'r')).toThrow(/identifier/)
  })

  it('rejects impossible status combinations', () => {
    expect(() => parseSimulationStatus(statusJson({ results_available: true }), 'r')).toThrow(/before completion/)
    expect(() => parseSimulationStatus(statusJson({ status: 'failed' }), 'r')).toThrow(/without an error/)
    expect(() => parseSimulationStatus(statusJson({ measurements_completed: 9 }), 'r')).toThrow(/exceeds/)
    expect(() => parseSimulationStatus(statusJson({ progress: 1.5 }), 'r')).toThrow(/between 0 and 1/)
  })

  it('refuses results that do not belong to a completed simulation', () => {
    const results = {
      simulation_id: SIM_ID,
      experiment_id: EXP_ID,
      experiment_version: 1,
      configuration_hash: 'd'.repeat(64),
      status: 'running',
      completed_at: null,
      summary: summaryJson,
    }
    expect(() => parseResults(results, 'r')).toThrow(/completed simulation/)
  })

  it('drops individual malformed measurement rows instead of rejecting the batch', () => {
    const rows = [row(0), row(1), row(2)]
    const cols = batchEvent(1, rows).columns
    ;(cols.raw!)[1] = null
    ;(cols.gravity_m_s2!)[2] = 'NaN'
    const batch = parseMeasurementColumns(cols, 0, 'c')
    expect(batch.rows.map((r) => r.index)).toEqual([0])
    expect(batch.rejected).toBe(2)
  })

  it('rejects structurally broken columns', () => {
    const short = batchEvent(1, [row(0), row(1)]).columns
    short.raw = [1]
    expect(() => parseMeasurementColumns(short, 0, 'c')).toThrow(/length mismatch/)
    const missing = batchEvent(1, [row(0), row(1)]).columns
    delete missing.noise
    expect(() => parseMeasurementColumns(missing, 0, 'c')).toThrow(/expected an array/)
  })

  it('checks measurement page counts', () => {
    const page = { simulation_id: SIM_ID, status: 'running', start_index: 0, count: 5, available: 2, total: 4, columns: batchEvent(1, [row(0), row(1)]).columns }
    expect(() => parseMeasurementPage(page, 'p')).toThrow(/count does not match/)
  })
})

describe('defaults and detectability', () => {
  it('accepts the shared contract files and requires the default scenario to exist', () => {
    const parsed = parseDefaults({ config: defaults, presets: clockPresets, scenarios }, 'defaults')
    expect(parsed.scenarios.scenarios.map((s) => s.id)).toContain(parsed.scenarios.default)
    expect(parsed.presets.every((p) => p.performance.field.stability_1s > 0)).toBe(true)
    expect(() => parseDefaults({ config: defaults, presets: clockPresets, scenarios: { ...scenarios, default: 'missing' } }, 'defaults')).toThrow(
      /default scenario must be listed/,
    )
  })

  it('accepts a study and rejects ragged or non-finite grids', () => {
    expect(parseDetectability(detectabilityJson(), 'study').significance_sigma).toHaveLength(3)
    const ragged = detectabilityJson()
    ragged.significance_sigma[1] = [1, 2]
    expect(() => parseDetectability(ragged, 'study')).toThrow(/one value per mass/)
    const nonFinite = { ...detectabilityJson(), nominal_sigma: Number.NaN }
    expect(() => parseDetectability(nonFinite, 'study')).toThrow(ParseError)
  })

  it('rejects unknown noise kinds in results', () => {
    const bad = JSON.parse(JSON.stringify(resultsWithKind('mystery'))) as unknown
    expect(() => parseResults(bad, 'results')).toThrow(/expected one of white, station, correlated, systematic/)
  })
})

function resultsWithKind(kind: string) {
  const r = resultsJsonForKind()
  r.noise_budget.components[0] = { ...r.noise_budget.components[0], kind } as (typeof r.noise_budget.components)[number]
  return r
}

describe('WebSocket message validation', () => {
  it('parses every known event type', () => {
    expect(parseMessage({ type: 'snapshot', simulation_id: SIM_ID, seq: 1, simulation: statusJson() }).kind).toBe('event')
    expect(parseMessage({ type: 'heartbeat', simulation_id: SIM_ID, seq: 2 }).kind).toBe('event')
    const batch = parseMessage(batchEvent(3, [row(0), row(1)]))
    expect(batch.kind === 'event' && batch.event.type === 'measurement_batch' && batch.event.batch.rows.length).toBe(2)
    const progress = parseMessage({
      type: 'simulation_progress',
      simulation_id: SIM_ID,
      seq: 4,
      progress: 0.3,
      phase: 'running_survey',
      measurements_completed: 2,
      measurements_total: 4,
      running_snr: 2.5,
    })
    expect(progress.kind).toBe('event')
  })

  it('normalizes the single-measurement event from the spec format', () => {
    const r = row(7)
    const message = {
      type: 'measurement',
      simulation_id: SIM_ID,
      seq: 5,
      measurement: { ...r, position: { x: r.x_m, y: r.y_m, z: r.z_m } },
    }
    const parsed = parseMessage(message)
    expect(parsed.kind === 'event' && parsed.event.type === 'measurement_batch' && parsed.event.batch.rows[0]?.index).toBe(7)
  })

  it('reports unknown types without crashing', () => {
    expect(parseMessage({ type: 'future_event', simulation_id: SIM_ID, seq: 1 })).toEqual({ kind: 'unknown', type: 'future_event' })
  })

  it('throws for malformed messages', () => {
    expect(() => parseMessage(null)).toThrow(ParseError)
    expect(() => parseMessage({ type: 'heartbeat', seq: 1 })).toThrow(ParseError)
    expect(() => parseMessage({ type: 'phase_changed', simulation_id: SIM_ID, seq: 1, phase: 'warp', stage: 'setup', progress: 0 })).toThrow(ParseError)
    expect(() => parseMessage({ type: 'simulation_completed', simulation_id: SIM_ID, seq: 1, simulation: statusJson() })).toThrow(ParseError)
    const bad = batchEvent(2, [row(0)])
    bad.count = 3
    expect(() => parseMessage(bad)).toThrow(/count mismatch/)
  })
})
