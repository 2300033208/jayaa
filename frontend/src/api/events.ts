import type { SimulationEvent } from '../types/api'
import { PHASES, STAGES } from '../types/api'
import { ParseError, finite, fraction, isRecord, literal, nonNegativeInteger, nullable, string } from './parse'
import {
  parseMeasurementColumns,
  parseSimulationError,
  parseSimulationStatus,
  parseSingleMeasurement,
  parseSummary,
} from './schemas'

export type ParsedMessage =
  | { kind: 'event'; event: SimulationEvent }
  | { kind: 'unknown'; type: string }

const STATUS_EVENTS = [
  'snapshot',
  'simulation_started',
  'simulation_paused',
  'simulation_resumed',
  'simulation_cancelling',
  'simulation_cancelled',
] as const

/** Validates a decoded WebSocket message. Throws ParseError for malformed messages. */
export function parseMessage(value: unknown): ParsedMessage {
  if (!isRecord(value)) throw new ParseError('message', 'expected an object')
  const type = string(value.type, 'message.type')
  const simulation_id = string(value.simulation_id, 'message.simulation_id')
  const seq = nonNegativeInteger(value.seq, 'message.seq')
  const base = { simulation_id, seq }

  switch (type) {
    case 'snapshot':
    case 'simulation_started':
    case 'simulation_paused':
    case 'simulation_resumed':
    case 'simulation_cancelling':
    case 'simulation_cancelled': {
      const simulation = parseSimulationStatus(value.simulation, 'message.simulation')
      const t = literal(STATUS_EVENTS)(type, 'message.type')
      return { kind: 'event', event: { type: t, ...base, simulation } }
    }
    case 'simulation_completed':
      return {
        kind: 'event',
        event: {
          type,
          ...base,
          simulation: parseSimulationStatus(value.simulation, 'message.simulation'),
          summary: parseSummary(value.summary, 'message.summary'),
        },
      }
    case 'simulation_failed':
      return {
        kind: 'event',
        event: {
          type,
          ...base,
          simulation: parseSimulationStatus(value.simulation, 'message.simulation'),
          error: parseSimulationError(value.error, 'message.error'),
        },
      }
    case 'phase_changed':
      return {
        kind: 'event',
        event: {
          type,
          ...base,
          phase: literal(PHASES)(value.phase, 'message.phase'),
          stage: literal(STAGES)(value.stage, 'message.stage'),
          progress: fraction(value.progress, 'message.progress'),
        },
      }
    case 'simulation_progress':
      return {
        kind: 'event',
        event: {
          type,
          ...base,
          progress: fraction(value.progress, 'message.progress'),
          phase: literal(PHASES)(value.phase, 'message.phase'),
          measurements_completed: nonNegativeInteger(value.measurements_completed, 'message.measurements_completed'),
          measurements_total: nonNegativeInteger(value.measurements_total, 'message.measurements_total'),
          running_snr: nullable(finite)(value.running_snr, 'message.running_snr'),
        },
      }
    case 'measurement_batch': {
      const start = nonNegativeInteger(value.start_index, 'message.start_index')
      const count = nonNegativeInteger(value.count, 'message.count')
      const batch = parseMeasurementColumns(value.columns, start, 'message.columns')
      if (batch.rows.length + batch.rejected !== count) throw new ParseError('message.count', 'count mismatch')
      return { kind: 'event', event: { type: 'measurement_batch', ...base, batch } }
    }
    case 'measurement':
      return {
        kind: 'event',
        event: { type: 'measurement_batch', ...base, batch: parseSingleMeasurement(value.measurement, 'message.measurement') },
      }
    case 'heartbeat':
      return { kind: 'event', event: { type: 'heartbeat', ...base } }
    default:
      return { kind: 'unknown', type }
  }
}
