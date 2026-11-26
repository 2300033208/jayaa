import { describe, expect, it } from 'vitest'
import type { MachineEvent, SimulationStatus } from './stateMachine'
import { SIMULATION_STATUSES, allowedActions, transition } from './stateMachine'

type SimpleEvent = Exclude<MachineEvent, { type: 'ATTACH' }>['type']
const ev = (type: SimpleEvent): MachineEvent => ({ type })

describe('simulation state machine', () => {
  it.each<[SimulationStatus, SimpleEvent, SimulationStatus]>([
    ['idle', 'VALIDATE', 'validating'],
    ['validating', 'VALIDATION_PASSED', 'starting'],
    ['validating', 'VALIDATION_FAILED', 'idle'],
    ['starting', 'STARTED', 'running'],
    ['starting', 'START_FAILED', 'failed'],
    ['running', 'PAUSED', 'paused'],
    ['paused', 'RESUMED', 'running'],
    ['running', 'CANCEL_REQUESTED', 'cancelling'],
    ['paused', 'CANCEL_REQUESTED', 'cancelling'],
    ['cancelling', 'CANCELLED', 'cancelled'],
    ['running', 'COMPLETED', 'completed'],
    ['running', 'FAILED', 'failed'],
    ['running', 'CANCELLED', 'cancelled'],
    ['completed', 'RESET', 'idle'],
    ['failed', 'RESET', 'idle'],
    ['cancelled', 'RESET', 'idle'],
  ])('%s --%s--> %s', (from, type, to) => {
    expect(transition(from, ev(type))).toEqual({ status: to, accepted: true })
  })

  it.each<[SimulationStatus, SimpleEvent]>([
    ['idle', 'PAUSED'],
    ['completed', 'RESUMED'],
    ['running', 'VALIDATE'],
    ['starting', 'VALIDATE'],
    ['idle', 'COMPLETED'],
    ['cancelled', 'COMPLETED'],
    ['cancelled', 'RESUMED'],
    ['completed', 'PAUSED'],
    ['failed', 'STARTED'],
    ['paused', 'COMPLETED'],
  ])('rejects %s --%s', (from, type) => {
    expect(transition(from, ev(type))).toEqual({ status: from, accepted: false })
  })

  it('attaches to a backend status only from a clean slate', () => {
    expect(transition('idle', { type: 'ATTACH', status: 'paused' })).toEqual({ status: 'paused', accepted: true })
    expect(transition('idle', { type: 'ATTACH', status: 'starting' }).status).toBe('running')
    expect(transition('running', { type: 'ATTACH', status: 'completed' })).toEqual({ status: 'running', accepted: false })
  })

  it('derives allowed actions from status, never from data', () => {
    for (const status of SIMULATION_STATUSES) {
      const a = allowedActions(status, true)
      expect(a.pause).toBe(status === 'running')
      expect(a.resume).toBe(status === 'paused')
      expect(a.start).toBe(['idle', 'completed', 'failed', 'cancelled'].includes(status))
    }
    expect(allowedActions('running', false).pause).toBe(false)
  })
})
