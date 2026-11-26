import { Ban, Pause, Pencil, Play, RotateCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { usePublishExperiment } from '../app/providers/shellContext'
import { Button } from '../components/controls/Button'
import { ErrorBoundary } from '../components/feedback/ErrorBoundary'
import { Banner, ErrorState, Skeleton } from '../components/feedback/States'
import { Page, PageHeader, Panel } from '../components/layout/Page'
import { PhaseTimeline } from '../components/simulation/PhaseTimeline'
import { ConnectionIndicator } from '../components/simulation/ProgressBar'
import { StatusBadge } from '../components/simulation/StatusBadge'
import { SignalChart } from '../features/analysis/SignalChart'
import { MetricsStrip } from '../features/sensor/MetricsStrip'
import { SensorPanel } from '../features/sensor/SensorPanel'
import { CompletionPanel } from '../features/simulation/CompletionPanel'
import { SimulationContext, useController, useSim } from '../features/simulation/context'
import { SimulationController } from '../features/simulation/controller'
import { readAutostart } from '../features/simulation/navigation'
import { SimulationChain } from '../features/simulation/SimulationChain'
import { allowedActions, isActive } from '../features/simulation/stateMachine'
import { SceneView } from '../features/survey/SceneView'
import type { Playback } from '../types/config'
import { formatInteger } from '../utils/format'
import { newId, shortHash } from '../utils/misc'
import { NoExperiment } from './NoExperiment'
import simStyles from '../features/simulation/simulation.module.css'

const PLAYBACK_OPTIONS: { value: Playback; label: string }[] = [
  { value: 'normal', label: 'Normal playback' },
  { value: 'fast', label: 'Fast playback' },
  { value: 'instant', label: 'Instant' },
]

/** 3D view bound to the live measurement count (re-renders per streamed batch; the page does not). */
function LiveScene({ className }: { className: string | undefined }) {
  const controller = useController()
  const received = useSim((s) => s.received)
  const plan = useSim((s) => s.plan)
  const planError = useSim((s) => s.planError)
  const simulationId = useSim((s) => s.simulationId)
  const live = useMemo(() => ({ buffer: controller.buffer, count: received }), [controller, received])
  return (
    <SceneView
      plan={plan}
      planError={planError}
      mode="live"
      live={live}
      description={`3D view of the survey area with ${plan?.bodies.length ?? 0} configured bodies, the survey path and ${received} measurements.`}
      resetKey={simulationId ?? 'preview'}
      className={className}
    />
  )
}

function LiveSignal({ exportName }: { exportName: string }) {
  const controller = useController()
  const received = useSim((s) => s.received)
  const status = useSim((s) => s.status)
  const source = useMemo(() => ({ buffer: controller.buffer, count: received, processed: null }), [controller, received])
  return <SignalChart id="live-signal" source={source} live={isActive(status)} awaitingData={status === 'idle' || isActive(status)} exportName={exportName} />
}

/** Partial-data notices for stopped runs (reads the received count only when relevant). */
function StoppedRunBanner() {
  const received = useSim((s) => s.received)
  const status = useSim((s) => s.status)
  const total = useSim((s) => s.measurementsTotal)
  if (status === 'cancelled') {
    return (
      <Banner tone="info" title="Simulation cancelled">
        Partial simulation: {formatInteger(received)} of {total === null ? 'unknown' : formatInteger(total)} measurements were recorded. No analysis results were produced.
      </Banner>
    )
  }
  if (status === 'failed' && total !== null && received < total) {
    return (
      <Banner tone="warning" title="Partial simulation">
        {formatInteger(received)} of {formatInteger(total)} measurements were recorded before the failure.
      </Banner>
    )
  }
  return null
}

function SimulationContent() {
  const controller = useController()
  const experiment = useSim((s) => s.experiment)
  const experimentError = useSim((s) => s.experimentError)
  const status = useSim((s) => s.status)
  const phase = useSim((s) => s.phase)
  const stage = useSim((s) => s.stage)
  const progress = useSim((s) => s.progress)
  const pending = useSim((s) => s.pending)
  const error = useSim((s) => s.error)
  const notice = useSim((s) => s.notice)
  const summary = useSim((s) => s.summary)
  const connection = useSim((s) => s.connection)
  const connectionInfo = useSim((s) => s.connectionInfo)
  const rejected = useSim((s) => s.rejected)
  const simulationId = useSim((s) => s.simulationId)
  const configurationHash = useSim((s) => s.configurationHash)
  const runVersion = useSim((s) => s.experimentVersion)
  const stalled = useSim((s) => s.stalled)
  const [playback, setPlayback] = useState<Playback>('normal')

  usePublishExperiment(experiment ? { id: experiment.id, code: experiment.code, name: experiment.name } : null)

  if (experimentError) {
    return (
      <Page label="Simulation">
        <PageHeader title="Simulation" />
        <ErrorState error={experimentError} actions={<Button onClick={() => void controller.load()}>Retry</Button>} />
      </Page>
    )
  }
  if (experiment === null) {
    return (
      <Page label="Simulation">
        <PageHeader title="Simulation" meta="Connecting to the simulation engine…" />
        <Skeleton height={420} label="Loading simulation" />
      </Page>
    )
  }

  const actions = allowedActions(status, phase === 'running_survey')
  const start = () => {
    void controller.start(experiment, playback, newId())
  }
  const staleConfig = configurationHash !== null && configurationHash !== experiment.configuration_hash
  const rejectedMessages = rejected.malformed + rejected.unknown + rejected.foreign + rejected.rows
  const analysisHref = `/experiments/${experiment.id}/analysis`
  const configHref = `/experiments/${experiment.id}`

  return (
    <Page label="Simulation">
      <PageHeader
        title="Simulation"
        eyebrow={`${experiment.code} · ${experiment.name}`}
        meta={
          <>
            <StatusBadge status={status} />
            {status !== 'idle' && <span className="mono">{Math.round(progress * 100)} %</span>}
            {simulationId && isActive(status) && <ConnectionIndicator state={connection} info={connectionInfo} />}
            {simulationId && <span className="mono">run {shortHash(simulationId)}</span>}
          </>
        }
        actions={
          <>
            {actions.start && (
              <label className={simStyles.inlineSelect}>
                <span className="visually-hidden">Playback speed</span>
                <select
                  value={playback}
                  onChange={(event) => {
                    const next = PLAYBACK_OPTIONS.find((o) => o.value === event.target.value)
                    if (next) setPlayback(next.value)
                  }}
                >
                  {PLAYBACK_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {actions.start && (
              <Button variant="primary" icon={status === 'idle' ? <Play /> : <RotateCw />} onClick={start}>
                {status === 'idle' ? 'Start simulation' : 'Run again'}
              </Button>
            )}
            {(status === 'validating' || status === 'starting') && (
              <Button variant="primary" busy>
                {status === 'validating' ? 'Validating' : 'Starting'}
              </Button>
            )}
            {status === 'running' && (
              <Button icon={<Pause />} onClick={() => void controller.pause()} disabled={!actions.pause} busy={pending === 'pause'}>
                Pause
              </Button>
            )}
            {status === 'paused' && (
              <Button icon={<Play />} onClick={() => void controller.resume()} busy={pending === 'resume'}>
                Resume
              </Button>
            )}
            {(actions.cancel || status === 'cancelling') && (
              <Button variant="danger" icon={<Ban />} onClick={() => void controller.cancel()} busy={pending === 'cancel' || status === 'cancelling'}>
                Cancel
              </Button>
            )}
            <Link to={configHref} className={simStyles.inlineSelect}>
              <Pencil aria-hidden="true" size={14} /> Configuration
            </Link>
          </>
        }
      />

      {notice && <Banner tone="info">{notice}</Banner>}
      {staleConfig && (
        <Banner tone="warning" title="Result out of date">
          This run used configuration version {runVersion ?? 'unknown'}; the experiment is now at version {experiment.version}. Run again to simulate the current configuration.
        </Banner>
      )}
      {stalled && (
        <Banner
          tone="warning"
          title="Simulation exceeded the expected execution time"
          actions={
            <>
              <Button size="sm" onClick={() => void controller.cancel()}>
                Cancel run
              </Button>
              <Link to={`${configHref}#survey`}>Reduce resolution</Link>
            </>
          }
        >
          The engine has not reported progress for 90 seconds.
        </Banner>
      )}
      {rejectedMessages > 0 && (
        <Banner tone="warning" title="Invalid engine messages rejected">
          {formatInteger(rejectedMessages)} message{rejectedMessages === 1 ? ' was' : 's were'} rejected by validation and not displayed. All values shown passed validation.
        </Banner>
      )}
      {connection === 'failed' && isActive(status) && (
        <Banner tone="critical" title="Live stream unavailable" actions={<Button size="sm" onClick={() => { controller.retryConnection() }}>Reconnect</Button>}>
          {connectionInfo.reason ?? 'The connection to the engine was lost.'} The last received data is kept.
        </Banner>
      )}
      {error && (status === 'failed' || status === 'idle') && (
        <ErrorState
          error={error}
          actions={
            <>
              {error.fields.length === 0 && <Button onClick={start}>Retry</Button>}
              {error.fields.length > 0 && <Link to={configHref}>Fix configuration</Link>}
              {error.code === 'timeout' && <Link to={`${configHref}#survey`}>Reduce resolution</Link>}
            </>
          }
        />
      )}
      <StoppedRunBanner />
      {status === 'completed' && summary && <CompletionPanel summary={summary} analysisHref={analysisHref} />}

      <div className={simStyles.top}>
        <LiveScene className={simStyles.sceneBox} />
        <Panel>
          <ErrorBoundary region="Sensor panel">
            <SensorPanel />
          </ErrorBoundary>
        </Panel>
      </div>

      <Panel>
        <LiveSignal exportName={`${experiment.code}-signal`} />
      </Panel>

      <MetricsStrip />

      <div className={simStyles.bottom}>
        <PhaseTimeline status={status} stage={stage} phase={phase} />
        <SimulationChain />
      </div>
    </Page>
  )
}

function SimulationView({ experimentId }: { experimentId: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [autostart] = useState(() => readAutostart(location.state))
  const [controller] = useState(() => new SimulationController(experimentId))

  useEffect(() => {
    controller.activate()
    void controller.load(autostart)
    return () => {
      controller.dispose()
    }
  }, [controller, autostart])

  // The start request is carried in router state only; clear it so a refresh never restarts a run.
  const { pathname } = location
  useEffect(() => {
    if (autostart !== null) void navigate(pathname, { replace: true, state: null })
  }, [autostart, navigate, pathname])

  return (
    <SimulationContext.Provider value={controller}>
      <SimulationContent />
    </SimulationContext.Provider>
  )
}

export default function SimulationPage() {
  const { experimentId } = useParams()
  if (experimentId === undefined) return <NoExperiment page="simulation" />
  return <SimulationView key={experimentId} experimentId={experimentId} />
}
