import { ApiError, isAbort } from '../../api/errors'
import * as experimentsApi from '../../api/experiments'
import * as simulationsApi from '../../api/simulations'
import * as analysisApi from '../../api/analysis'
import type { ConnectionInfo, ConnectionState, RejectionKind, SocketHandlers, SocketOptions } from '../../api/socket'
import { SimulationSocket } from '../../api/socket'
import type {
  Experiment,
  Phase,
  ResultSummary,
  SimulationEvent,
  SimulationStatusDoc,
  Stage,
  SurveyPlan,
} from '../../types/api'
import type { Playback } from '../../types/config'
import type { Store } from '../../utils/store'
import { createStore } from '../../utils/store'
import type { UserError } from '../../utils/userError'
import { userError } from '../../utils/userError'
import { MeasurementBuffer } from './measurementBuffer'
import type { MachineEvent, SimulationStatus } from './stateMachine'
import { allowedActions, isTerminal, transition } from './stateMachine'

export interface SimulationState {
  experimentId: string
  experiment: Experiment | null
  experimentError: UserError | null
  simulationId: string | null
  configurationHash: string | null
  experimentVersion: number | null
  status: SimulationStatus
  phase: Phase | null
  stage: Stage | null
  progress: number
  measurementsCompleted: number
  measurementsTotal: number | null
  /** Rows held in the buffer; charts and the scene re-read the buffer when this changes. */
  received: number
  runningSnr: number | null
  plan: SurveyPlan | null
  planError: UserError | null
  playback: Playback
  connection: ConnectionState
  connectionInfo: ConnectionInfo
  pending: 'pause' | 'resume' | 'cancel' | null
  loading: boolean
  error: UserError | null
  notice: string | null
  summary: ResultSummary | null
  rejected: { malformed: number; unknown: number; foreign: number; rows: number }
  /** True when a running simulation has made no progress for STALL_MS (heartbeats excluded). */
  stalled: boolean
}

export interface ControllerDeps {
  getExperiment: typeof experimentsApi.getExperiment
  validateExperiment: typeof experimentsApi.validateExperiment
  getPlanPreview: typeof experimentsApi.getPlanPreview
  startSimulation: typeof simulationsApi.startSimulation
  getSimulationStatus: typeof simulationsApi.getSimulationStatus
  pauseSimulation: typeof simulationsApi.pauseSimulation
  resumeSimulation: typeof simulationsApi.resumeSimulation
  cancelSimulation: typeof simulationsApi.cancelSimulation
  getSurveyPlan: typeof simulationsApi.getSurveyPlan
  getMeasurements: typeof simulationsApi.getMeasurements
  getSimulationResults: typeof analysisApi.getSimulationResults
  createSocket: (simulationId: string, handlers: SocketHandlers, options?: SocketOptions) => SimulationSocket
  scheduleFrame: (callback: () => void) => void
}

export const defaultDeps: ControllerDeps = {
  getExperiment: experimentsApi.getExperiment,
  validateExperiment: experimentsApi.validateExperiment,
  getPlanPreview: experimentsApi.getPlanPreview,
  startSimulation: simulationsApi.startSimulation,
  getSimulationStatus: simulationsApi.getSimulationStatus,
  pauseSimulation: simulationsApi.pauseSimulation,
  resumeSimulation: simulationsApi.resumeSimulation,
  cancelSimulation: simulationsApi.cancelSimulation,
  getSurveyPlan: simulationsApi.getSurveyPlan,
  getMeasurements: simulationsApi.getMeasurements,
  getSimulationResults: analysisApi.getSimulationResults,
  createSocket: (id, handlers, options) => new SimulationSocket(id, handlers, options),
  scheduleFrame: (callback) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { callback() })
    else queueMicrotask(callback)
  },
}

const STATUS_EVENT_TYPES = new Set<SimulationEvent['type']>([
  'snapshot',
  'simulation_started',
  'simulation_paused',
  'simulation_resumed',
  'simulation_cancelling',
  'simulation_cancelled',
  'simulation_completed',
  'simulation_failed',
  'phase_changed',
  'simulation_progress',
])

function failureError(doc: SimulationStatusDoc): UserError {
  return {
    title: 'Simulation failed',
    message: doc.error?.message ?? 'The engine reported a failure without details.',
    code: doc.error?.code ?? 'simulation_error',
    retryable: true,
    engineUnavailable: false,
    fields: [],
  }
}

function initialState(experimentId: string): SimulationState {
  return {
    experimentId,
    experiment: null,
    experimentError: null,
    simulationId: null,
    configurationHash: null,
    experimentVersion: null,
    status: 'idle',
    phase: null,
    stage: null,
    progress: 0,
    measurementsCompleted: 0,
    measurementsTotal: null,
    received: 0,
    runningSnr: null,
    plan: null,
    planError: null,
    playback: 'normal',
    connection: 'idle',
    connectionInfo: { attempt: 0, reason: null },
    pending: null,
    loading: false,
    error: null,
    notice: null,
    summary: null,
    rejected: { malformed: 0, unknown: 0, foreign: 0, rows: 0 },
    stalled: false,
  }
}

export const STALL_MS = 90_000
const WATCHDOG_INTERVAL_MS = 5_000

/**
 * Owns one experiment's simulation lifecycle on the Simulation page. All async work is tied
 * to this controller's AbortController and simulation id: after `dispose()` or after a new
 * run replaces the old one, late responses and socket events are discarded.
 */
export class SimulationController {
  readonly store: Store<SimulationState>
  readonly buffer = new MeasurementBuffer()
  private readonly deps: ControllerDeps
  private lifetime = new AbortController()
  private socket: SimulationSocket | null = null
  private runToken = 0
  private lastStatusSeq = -1
  private flushScheduled = false
  private startInFlight = false
  private disposed = false
  private watchdog: ReturnType<typeof setInterval> | null = null
  private lastActivity = 0

  constructor(experimentId: string, deps: ControllerDeps = defaultDeps) {
    this.deps = deps
    this.store = createStore(initialState(experimentId))
  }

  get state(): SimulationState {
    return this.store.getState()
  }

  /** Starts (or restarts, e.g. after a StrictMode remount) the controller's lifetime. */
  activate(): void {
    if (!this.disposed) return
    this.disposed = false
    this.lifetime = new AbortController()
  }

  /** Stops all work: aborts requests, closes the stream, and invalidates pending continuations. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.runToken += 1
    this.lifetime.abort()
    this.closeSocket()
  }

  private startWatchdog(): void {
    this.stopWatchdog()
    this.lastActivity = Date.now()
    this.watchdog = globalThis.setInterval(() => {
      const stalled = this.state.status === 'running' && Date.now() - this.lastActivity > STALL_MS
      if (stalled !== this.state.stalled) this.set({ stalled })
    }, WATCHDOG_INTERVAL_MS)
  }

  private stopWatchdog(): void {
    if (this.watchdog !== null) globalThis.clearInterval(this.watchdog)
    this.watchdog = null
  }

  /** False once the run that issued `token` was replaced or the controller was disposed. */
  private isCurrent(token: number): boolean {
    return token === this.runToken && !this.disposed
  }

  private set(patch: Partial<SimulationState>): void {
    if (!this.disposed) this.store.setState(patch)
  }

  private dispatch(event: MachineEvent): boolean {
    const result = transition(this.state.status, event)
    if (result.accepted) this.set({ status: result.status })
    return result.accepted
  }

  private get signal(): AbortSignal {
    return this.lifetime.signal
  }

  private closeSocket(): void {
    this.stopWatchdog()
    this.socket?.close()
    this.socket = null
  }

  /** Resets per-run state so a new run (or attach) starts from a clean slate. */
  private resetRun(): void {
    this.closeSocket()
    this.runToken += 1
    this.lastStatusSeq = -1
    this.buffer.clear()
    this.dispatch({ type: 'RESET' })
    const keep = this.state
    this.store.setState({
      ...initialState(keep.experimentId),
      experiment: keep.experiment,
      plan: keep.plan,
      playback: keep.playback,
    })
  }

  /* ------------------------------------------------------------------ attach / load */

  /**
   * Loads the experiment and attaches to its latest simulation (after navigation or a browser
   * refresh). When `autostart` is given and no run is active, a new run is started with that
   * idempotency key, so repeating the call can never create a second simulation.
   */
  async load(autostart: { key: string; playback: Playback } | null = null): Promise<void> {
    const token = this.runToken
    this.set({ loading: true, experimentError: null })
    let experiment: Experiment
    try {
      experiment = await this.deps.getExperiment(this.state.experimentId, this.signal)
    } catch (error) {
      if (!isAbort(error) && this.isCurrent(token)) {
        this.set({ loading: false, experimentError: userError(error, 'Experiment unavailable') })
      }
      return
    }
    if (!this.isCurrent(token)) return
    this.set({ experiment, experimentVersion: experiment.version })
    await this.attach(experiment)
    if (!this.isCurrent(token)) return
    this.set({ loading: false })
    if (autostart && allowedActions(this.state.status, false).start) {
      await this.start(experiment, autostart.playback, autostart.key)
    }
  }

  /** Attaches to the experiment's latest simulation, or loads the plan preview when there is none. */
  async attach(experiment: Experiment): Promise<void> {
    const latest = experiment.latest_simulation
    if (latest === null) {
      await this.loadPlanPreview(experiment.id)
      return
    }
    await this.attachSimulation(latest.id)
  }

  private async loadPlanPreview(experimentId: string): Promise<void> {
    const token = this.runToken
    try {
      const plan = await this.deps.getPlanPreview(experimentId, this.signal)
      if (this.isCurrent(token)) this.set({ plan, planError: null })
    } catch (error) {
      if (!isAbort(error) && this.isCurrent(token)) this.set({ planError: userError(error, 'Survey plan unavailable') })
    }
  }

  private async attachSimulation(simulationId: string): Promise<void> {
    if (this.state.status !== 'idle') this.resetRun()
    const token = this.runToken
    let status: SimulationStatusDoc
    try {
      status = await this.deps.getSimulationStatus(simulationId, this.signal)
    } catch (error) {
      if (!isAbort(error) && this.isCurrent(token)) this.set({ error: userError(error, 'Could not load the simulation') })
      return
    }
    if (!this.isCurrent(token)) return
    this.dispatch({ type: 'ATTACH', status: status.status })
    this.applyStatusFields(status)
    this.set({ playback: status.playback })
    if (status.status === 'failed') this.set({ error: failureError(status) })
    await Promise.all([this.loadPlan(simulationId, token), this.backfill(simulationId, token)])
    if (!this.isCurrent(token)) return
    if (isTerminal(this.state.status)) {
      if (this.state.status === 'completed') await this.loadSummary(simulationId, token)
    } else {
      this.openSocket(simulationId, token)
    }
  }

  private async loadPlan(simulationId: string, token: number): Promise<void> {
    try {
      const plan = await this.deps.getSurveyPlan(simulationId, this.signal)
      if (this.isCurrent(token)) this.set({ plan, planError: null })
    } catch (error) {
      if (!isAbort(error) && this.isCurrent(token)) this.set({ planError: userError(error, 'Survey plan unavailable') })
    }
  }

  /** Fetches measurements missing from the buffer (REST), e.g. after refresh or at completion. */
  private async backfill(simulationId: string, token: number): Promise<void> {
    try {
      const page = await this.deps.getMeasurements(simulationId, this.buffer.lastIndex, this.signal)
      if (!this.isCurrent(token)) return
      this.ingest(page.batch.rows, page.batch.rejected)
      this.flush()
    } catch (error) {
      if (!isAbort(error) && this.isCurrent(token)) {
        this.set({ notice: userError(error, 'Measurements unavailable').message })
      }
    }
  }

  private async loadSummary(simulationId: string, token: number): Promise<void> {
    try {
      const results = await this.deps.getSimulationResults(simulationId, this.signal)
      if (this.isCurrent(token)) this.set({ summary: results.summary })
    } catch (error) {
      if (!isAbort(error) && this.isCurrent(token)) {
        this.set({ notice: userError(error, 'Result summary unavailable').message })
      }
    }
  }

  /* ------------------------------------------------------------------ start */

  async start(experiment: Experiment, playback: Playback, idempotencyKey: string): Promise<void> {
    if (this.disposed || this.startInFlight) return
    if (!allowedActions(this.state.status, false).start) return
    this.startInFlight = true
    try {
      if (this.state.status !== 'idle') this.resetRun()
      const token = this.runToken
      this.set({ playback, error: null, notice: null, experiment, experimentVersion: experiment.version })
      this.dispatch({ type: 'VALIDATE' })

      let valid = false
      try {
        const report = await this.deps.validateExperiment(experiment.config, this.signal)
        valid = report.valid
        if (!valid) {
          this.dispatch({ type: 'VALIDATION_FAILED' })
          this.set({
            error: {
              title: 'Configuration is invalid',
              message: 'Fix the highlighted fields in the experiment configuration before starting.',
              code: 'invalid_configuration',
              retryable: false,
              engineUnavailable: false,
              fields: report.errors,
            },
          })
          return
        }
      } catch (error) {
        if (isAbort(error)) return
        this.dispatch({ type: 'VALIDATION_FAILED' })
        this.set({ error: userError(error, 'Validation failed') })
        return
      }
      if (!this.isCurrent(token)) return
      this.dispatch({ type: 'VALIDATION_PASSED' })

      let status: SimulationStatusDoc
      try {
        status = await this.deps.startSimulation(
          experiment.id,
          { playback, expectedConfigurationHash: experiment.configuration_hash, idempotencyKey },
          this.signal,
        )
      } catch (error) {
        if (isAbort(error)) return
        if (error instanceof ApiError && error.code === 'simulation_active' && typeof error.details.simulation_id === 'string') {
          const activeId = error.details.simulation_id
          this.dispatch({ type: 'ABORT' })
          this.set({ notice: 'A simulation was already running for this experiment. Showing it instead.' })
          await this.attachSimulation(activeId)
          return
        }
        this.dispatch({ type: 'START_FAILED' })
        this.set({ error: userError(error, 'The simulation could not be started') })
        return
      }
      if (!this.isCurrent(token)) return
      this.dispatch({ type: 'STARTED' })
      this.applyStatusFields(status)
      this.applyStatus(status)
      void this.loadPlan(status.id, token)
      if (!isTerminal(this.state.status)) this.openSocket(status.id, token)
      else await this.backfill(status.id, token)
    } finally {
      this.startInFlight = false
    }
  }

  /* ------------------------------------------------------------------ controls */

  async pause(): Promise<void> {
    await this.control('pause', this.deps.pauseSimulation)
  }

  async resume(): Promise<void> {
    await this.control('resume', this.deps.resumeSimulation)
  }

  async cancel(): Promise<void> {
    await this.control('cancel', this.deps.cancelSimulation)
  }

  private async control(
    action: 'pause' | 'resume' | 'cancel',
    call: (id: string, signal?: AbortSignal) => Promise<SimulationStatusDoc>,
  ): Promise<void> {
    const { simulationId, pending, status, phase } = this.state
    if (simulationId === null || pending !== null) return
    if (!allowedActions(status, phase === 'running_survey')[action]) return
    const token = this.runToken
    this.set({ pending: action, notice: null })
    try {
      const doc = await call(simulationId, this.signal)
      if (this.isCurrent(token)) this.applyStatus(doc)
    } catch (error) {
      if (!isAbort(error) && this.isCurrent(token)) {
        this.set({ notice: userError(error, `Could not ${action} the simulation`).message })
      }
    } finally {
      if (this.isCurrent(token)) this.set({ pending: null })
    }
  }

  retryConnection(): void {
    this.socket?.retry()
  }

  /* ------------------------------------------------------------------ stream */

  private openSocket(simulationId: string, token: number): void {
    this.closeSocket()
    const socket = this.deps.createSocket(simulationId, {
      onEvent: (event) => {
        if (this.isCurrent(token)) this.handleEvent(event, token)
      },
      onState: (connection, connectionInfo) => {
        if (this.isCurrent(token)) this.set({ connection, connectionInfo })
      },
      onRejected: (kind: RejectionKind) => {
        if (!this.isCurrent(token)) return
        const rejected = { ...this.state.rejected, [kind]: this.state.rejected[kind] + 1 }
        this.set({ rejected })
      },
      resumeIndex: () => this.buffer.lastIndex,
    })
    this.socket = socket
    socket.connect()
    this.startWatchdog()
  }

  private handleEvent(event: SimulationEvent, token: number): void {
    if (event.simulation_id !== this.state.simulationId) return
    if (event.type !== 'heartbeat') {
      this.lastActivity = Date.now()
      if (this.state.stalled) this.set({ stalled: false })
    }
    if (STATUS_EVENT_TYPES.has(event.type)) {
      // Status updates must be monotonic; replayed measurement batches are deduplicated by index instead.
      if (event.seq < this.lastStatusSeq) return
      this.lastStatusSeq = event.seq
    }
    switch (event.type) {
      case 'measurement_batch':
        this.ingest(event.batch.rows, event.batch.rejected)
        this.scheduleFlush()
        return
      case 'phase_changed':
        this.set({ phase: event.phase, stage: event.stage, progress: event.progress })
        return
      case 'simulation_progress':
        this.set({
          progress: event.progress,
          phase: event.phase,
          measurementsCompleted: event.measurements_completed,
          measurementsTotal: event.measurements_total,
          runningSnr: event.running_snr,
        })
        return
      case 'simulation_completed':
        this.applyStatus(event.simulation)
        this.set({ summary: event.summary })
        this.finishStream(event.simulation, token)
        return
      case 'simulation_failed':
        this.applyStatus(event.simulation)
        this.finishStream(event.simulation, token)
        return
      case 'snapshot':
      case 'simulation_started':
      case 'simulation_paused':
      case 'simulation_resumed':
      case 'simulation_cancelling':
      case 'simulation_cancelled':
        this.applyStatus(event.simulation)
        if (isTerminal(this.state.status)) this.finishStream(event.simulation, token)
        return
      case 'heartbeat':
        return
    }
  }

  private finishStream(doc: SimulationStatusDoc, token: number): void {
    this.flush()
    this.closeSocket()
    if (this.buffer.length < doc.measurements_completed) void this.backfill(doc.id, token)
    if (doc.status === 'completed' && this.state.summary === null) void this.loadSummary(doc.id, token)
  }

  private ingest(rows: Parameters<MeasurementBuffer['append']>[0], rejectedRows: number): void {
    this.buffer.append(rows)
    if (rejectedRows > 0) {
      const rejected = { ...this.state.rejected, rows: this.state.rejected.rows + rejectedRows }
      this.set({ rejected })
    }
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return
    this.flushScheduled = true
    this.deps.scheduleFrame(() => {
      this.flushScheduled = false
      this.flush()
    })
  }

  private flush(): void {
    this.set({ received: this.buffer.length })
  }

  /* ------------------------------------------------------------------ status mapping */

  private applyStatusFields(doc: SimulationStatusDoc): void {
    this.set({
      simulationId: doc.id,
      configurationHash: doc.configuration_hash,
      experimentVersion: doc.experiment_version,
      phase: doc.phase,
      stage: doc.stage,
      progress: doc.progress,
      measurementsCompleted: doc.measurements_completed,
      measurementsTotal: doc.measurements_total,
      runningSnr: doc.running_snr,
    })
  }

  private applyStatus(doc: SimulationStatusDoc): void {
    if (doc.id !== this.state.simulationId) return
    const current = this.state.status
    switch (doc.status) {
      case 'starting':
      case 'running':
        if (current === 'paused') this.dispatch({ type: 'RESUMED' })
        else if (current === 'starting') this.dispatch({ type: 'STARTED' })
        break
      case 'paused':
        this.dispatch({ type: 'PAUSED' })
        break
      case 'cancelling':
        this.dispatch({ type: 'CANCEL_REQUESTED' })
        break
      case 'cancelled':
        this.dispatch({ type: 'CANCELLED' })
        break
      case 'completed':
        this.dispatch({ type: 'COMPLETED' })
        break
      case 'failed':
        this.dispatch({ type: 'FAILED' })
        this.set({ error: failureError(doc) })
        break
    }
    this.applyStatusFields(doc)
  }
}
