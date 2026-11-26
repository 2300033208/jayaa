import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/errors'
import { parseExperiment, parsePlan, parseResults, parseSimulationStatus } from '../../api/schemas'
import { SimulationSocket } from '../../api/socket'
import { FakeSocket } from '../../test/fakeSocket'
import { EXP_ID, OTHER_SIM_ID, SIM_ID, batchEvent, experimentJson, planJson, resultsJson, row, statusJson, summaryJson } from '../../test/fixtures'
import type { ControllerDeps } from './controller'
import { STALL_MS, SimulationController } from './controller'

const status = (overrides: Record<string, unknown> = {}) => parseSimulationStatus(statusJson(overrides), 'r')
const completedStatus = { status: 'completed', phase: 'complete', stage: 'complete', progress: 1, results_available: true, measurements_completed: 4 }

function makeDeps(overrides: Partial<ControllerDeps> = {}): ControllerDeps {
  return {
    getExperiment: vi.fn(() => Promise.resolve(parseExperiment(experimentJson(), 'r'))),
    validateExperiment: vi.fn(() => Promise.resolve({ valid: true, errors: [], warnings: [], derived: null })),
    getPlanPreview: vi.fn(() => Promise.resolve(parsePlan(planJson(), 'r'))),
    startSimulation: vi.fn(() => Promise.resolve(status({ status: 'starting', phase: 'initializing_earth_model', stage: 'setup', progress: 0 }))),
    getSimulationStatus: vi.fn(() => Promise.resolve(status())),
    pauseSimulation: vi.fn(() => Promise.resolve(status({ status: 'paused' }))),
    resumeSimulation: vi.fn(() => Promise.resolve(status({ status: 'running' }))),
    cancelSimulation: vi.fn(() => Promise.resolve(status({ status: 'cancelling' }))),
    getSurveyPlan: vi.fn(() => Promise.resolve(parsePlan(planJson(), 'r'))),
    getMeasurements: vi.fn(() =>
      Promise.resolve({ simulation_id: SIM_ID, status: 'running' as const, start_index: 0, count: 0, available: 0, total: 4, batch: { startIndex: 0, rows: [], rejected: 0 } }),
    ),
    getSimulationResults: vi.fn(() => Promise.resolve(parseResults(resultsJson(), 'r'))),
    createSocket: (id, handlers, options) => new SimulationSocket(id, handlers, { ...options, createSocket: (url) => new FakeSocket(url) }),
    scheduleFrame: (callback) => {
      callback()
    },
    ...overrides,
  }
}

async function started(deps = makeDeps()) {
  const controller = new SimulationController(EXP_ID, deps)
  await controller.load()
  const experiment = controller.state.experiment
  if (experiment === null) throw new Error('experiment did not load')
  await controller.start(experiment, 'normal', 'key-000001')
  const ws = FakeSocket.latest()
  ws.open()
  return { controller, ws, deps }
}

beforeEach(() => {
  FakeSocket.reset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SimulationController', () => {
  it('create → validate → start → measurements → complete → results', async () => {
    const { controller, ws, deps } = await started()
    expect(deps.validateExperiment).toHaveBeenCalledTimes(1)
    expect(deps.startSimulation).toHaveBeenCalledWith(EXP_ID, expect.objectContaining({ idempotencyKey: 'key-000001' }), expect.anything())
    expect(controller.state.status).toBe('running')
    ws.send({ type: 'snapshot', simulation_id: SIM_ID, seq: 1, simulation: statusJson() })
    ws.send(batchEvent(2, [row(0), row(1)]))
    ws.send(batchEvent(3, [row(1), row(2), row(3)]))
    expect(controller.state.received).toBe(4)
    expect(controller.buffer.duplicates).toBe(1)
    ws.send({ type: 'simulation_completed', simulation_id: SIM_ID, seq: 4, simulation: statusJson(completedStatus), summary: summaryJson })
    expect(controller.state.status).toBe('completed')
    expect(controller.state.summary?.anomaly_detected).toBe(true)
    expect(ws.closed).toBe(true)
  })

  it('RUNNING → PAUSED → RUNNING', async () => {
    const { controller, ws } = await started()
    ws.send({ type: 'phase_changed', simulation_id: SIM_ID, seq: 2, phase: 'running_survey', stage: 'measurement', progress: 0.03 })
    await controller.pause()
    expect(controller.state.status).toBe('paused')
    await controller.resume()
    expect(controller.state.status).toBe('running')
  })

  it('does not allow pause outside the survey phase', async () => {
    const { controller, deps } = await started()
    expect(controller.state.phase).toBe('initializing_earth_model')
    await controller.pause()
    expect(deps.pauseSimulation).not.toHaveBeenCalled()
  })

  it('RUNNING → CANCELLING → CANCELLED, and a cancelled run stops updating the UI', async () => {
    const { controller, ws } = await started()
    await controller.cancel()
    expect(controller.state.status).toBe('cancelling')
    ws.send({ type: 'simulation_cancelled', simulation_id: SIM_ID, seq: 5, simulation: statusJson({ status: 'cancelled' }) })
    expect(controller.state.status).toBe('cancelled')
    ws.send(batchEvent(6, [row(0)]))
    expect(controller.state.received).toBe(0)
  })

  it('RUNNING → FAILED shows the engine reason', async () => {
    const { controller, ws } = await started()
    const error = { code: 'simulation_error', phase: 'performing_inversion', message: 'RuntimeError: singular matrix' }
    ws.send({ type: 'simulation_failed', simulation_id: SIM_ID, seq: 3, simulation: statusJson({ status: 'failed', error }), error })
    expect(controller.state.status).toBe('failed')
    expect(controller.state.error?.message).toBe('RuntimeError: singular matrix')
  })

  it('ignores a second start while one is in flight', async () => {
    const deps = makeDeps()
    const controller = new SimulationController(EXP_ID, deps)
    await controller.load()
    const experiment = controller.state.experiment
    if (experiment === null) throw new Error('no experiment')
    await Promise.all([controller.start(experiment, 'normal', 'k-00000001'), controller.start(experiment, 'normal', 'k-00000002')])
    expect(deps.startSimulation).toHaveBeenCalledTimes(1)
  })

  it('stops at validation when the engine rejects the configuration', async () => {
    const deps = makeDeps({
      validateExperiment: vi.fn(() =>
        Promise.resolve({ valid: false, errors: [{ field: 'bodies.0.depth_m', message: 'Depth must be greater than 0 m.' }], warnings: [], derived: null }),
      ),
    })
    const controller = new SimulationController(EXP_ID, deps)
    await controller.load()
    const experiment = controller.state.experiment
    if (experiment === null) throw new Error('no experiment')
    await controller.start(experiment, 'normal', 'k-00000003')
    expect(controller.state.status).toBe('idle')
    expect(controller.state.error?.fields[0]?.message).toBe('Depth must be greater than 0 m.')
    expect(deps.startSimulation).not.toHaveBeenCalled()
  })

  it('ignores status events that are older than the latest one', async () => {
    const { controller, ws } = await started()
    ws.send({ type: 'simulation_paused', simulation_id: SIM_ID, seq: 10, simulation: statusJson({ status: 'paused' }) })
    ws.send({ type: 'simulation_resumed', simulation_id: SIM_ID, seq: 9, simulation: statusJson({ status: 'running' }) })
    expect(controller.state.status).toBe('paused')
  })

  it('ignores events for another simulation', async () => {
    const { controller, ws } = await started()
    ws.send(batchEvent(2, [row(0)], OTHER_SIM_ID))
    expect(controller.state.received).toBe(0)
    expect(controller.state.rejected.foreign).toBe(1)
  })

  it('attaches to a running simulation after a refresh without duplicating data', async () => {
    const deps = makeDeps({
      getExperiment: vi.fn(() =>
        Promise.resolve(parseExperiment(experimentJson({ id: SIM_ID, status: 'running', configuration_hash: 'd'.repeat(64), experiment_version: 1, created_at: 'x', completed_at: null, results_available: false }), 'r')),
      ),
      getMeasurements: vi.fn(() =>
        Promise.resolve({ simulation_id: SIM_ID, status: 'running' as const, start_index: 0, count: 2, available: 2, total: 4, batch: { startIndex: 0, rows: [row(0), row(1)], rejected: 0 } }),
      ),
    })
    const controller = new SimulationController(EXP_ID, deps)
    await controller.load()
    expect(controller.state.status).toBe('running')
    expect(controller.state.received).toBe(2)
    const ws = FakeSocket.latest()
    expect(ws.url).toContain('after_index=1')
    ws.open()
    ws.send(batchEvent(3, [row(1), row(2)]))
    expect(controller.state.received).toBe(3)
    expect(deps.startSimulation).not.toHaveBeenCalled()
  })

  it('shows the already-running simulation when the engine reports a conflict', async () => {
    const deps = makeDeps({
      startSimulation: vi.fn(() =>
        Promise.reject(new ApiError('http', 'A simulation is already running for this experiment.', { status: 409, code: 'simulation_active', details: { simulation_id: SIM_ID } })),
      ),
    })
    const controller = new SimulationController(EXP_ID, deps)
    await controller.load()
    const experiment = controller.state.experiment
    if (experiment === null) throw new Error('no experiment')
    await controller.start(experiment, 'normal', 'k-00000004')
    expect(controller.state.status).toBe('running')
    expect(controller.state.simulationId).toBe(SIM_ID)
    expect(controller.state.notice).toMatch(/already running/)
  })

  it('stops all updates after dispose', async () => {
    const { controller, ws } = await started()
    controller.dispose()
    ws.send(batchEvent(2, [row(0)]))
    expect(controller.state.received).toBe(0)
  })

  it('flags a stalled run and clears the flag when progress resumes', async () => {
    vi.useFakeTimers()
    const { controller, ws } = await started()
    // Connection alive (heartbeats every 10 s) but no progress events: that is a stall.
    for (let elapsed = 0; elapsed < STALL_MS + 10_000; elapsed += 10_000) {
      vi.advanceTimersByTime(10_000)
      ws.send({ type: 'heartbeat', simulation_id: SIM_ID, seq: 1 })
    }
    expect(FakeSocket.instances).toHaveLength(1)
    expect(controller.state.stalled).toBe(true)
    ws.send({ type: 'phase_changed', simulation_id: SIM_ID, seq: 2, phase: 'running_survey', stage: 'measurement', progress: 0.1 })
    expect(controller.state.stalled).toBe(false)
    controller.dispose()
  })
})
