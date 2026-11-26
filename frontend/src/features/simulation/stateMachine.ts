import type { BackendStatus } from '../../types/api'

export const SIMULATION_STATUSES = [
  'idle',
  'validating',
  'starting',
  'running',
  'paused',
  'cancelling',
  'cancelled',
  'completed',
  'failed',
] as const
export type SimulationStatus = (typeof SIMULATION_STATUSES)[number]

export type MachineEvent =
  | { type: 'VALIDATE' }
  | { type: 'VALIDATION_PASSED' }
  | { type: 'VALIDATION_FAILED' }
  | { type: 'STARTED' }
  | { type: 'START_FAILED' }
  | { type: 'ABORT' }
  | { type: 'PAUSED' }
  | { type: 'RESUMED' }
  | { type: 'CANCEL_REQUESTED' }
  | { type: 'CANCELLED' }
  | { type: 'COMPLETED' }
  | { type: 'FAILED' }
  | { type: 'RESET' }
  | { type: 'ATTACH'; status: BackendStatus }

type EventType = MachineEvent['type']

/** Every allowed transition. Anything not listed is rejected. */
const TRANSITIONS: Record<SimulationStatus, Partial<Record<Exclude<EventType, 'ATTACH'>, SimulationStatus>>> = {
  idle: { VALIDATE: 'validating' },
  validating: { VALIDATION_PASSED: 'starting', VALIDATION_FAILED: 'idle', ABORT: 'idle' },
  starting: { STARTED: 'running', START_FAILED: 'failed', ABORT: 'idle', FAILED: 'failed' },
  running: { PAUSED: 'paused', CANCEL_REQUESTED: 'cancelling', COMPLETED: 'completed', FAILED: 'failed', CANCELLED: 'cancelled' },
  paused: { RESUMED: 'running', CANCEL_REQUESTED: 'cancelling', FAILED: 'failed', CANCELLED: 'cancelled' },
  cancelling: { CANCELLED: 'cancelled', COMPLETED: 'completed', FAILED: 'failed' },
  cancelled: { RESET: 'idle' },
  completed: { RESET: 'idle' },
  failed: { RESET: 'idle' },
}

/** Backend status → frontend status, used when attaching to an existing simulation. */
export function statusFromBackend(status: BackendStatus): SimulationStatus {
  switch (status) {
    case 'starting':
    case 'running':
      return 'running'
    case 'paused':
      return 'paused'
    case 'cancelling':
      return 'cancelling'
    case 'cancelled':
      return 'cancelled'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
  }
}

export interface TransitionResult {
  status: SimulationStatus
  accepted: boolean
}

export function transition(status: SimulationStatus, event: MachineEvent): TransitionResult {
  if (event.type === 'ATTACH') {
    // Attaching only happens from a clean slate (page load, refresh, or after RESET).
    return status === 'idle' ? { status: statusFromBackend(event.status), accepted: true } : { status, accepted: false }
  }
  const next = TRANSITIONS[status][event.type]
  return next === undefined ? { status, accepted: false } : { status: next, accepted: true }
}

export const TERMINAL_STATUSES: readonly SimulationStatus[] = ['completed', 'failed', 'cancelled']
export const ACTIVE_STATUSES: readonly SimulationStatus[] = ['validating', 'starting', 'running', 'paused', 'cancelling']

export function isTerminal(status: SimulationStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

export function isActive(status: SimulationStatus): boolean {
  return ACTIVE_STATUSES.includes(status)
}

/** Which user actions are allowed in a status (UI buttons derive from this, never from data). */
export function allowedActions(status: SimulationStatus, phaseAllowsPause: boolean) {
  return {
    start: status === 'idle' || isTerminal(status),
    pause: status === 'running' && phaseAllowsPause,
    resume: status === 'paused',
    cancel: status === 'running' || status === 'paused',
  }
}
