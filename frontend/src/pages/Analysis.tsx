import { Download, FileText } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { exportUrl, getAnomalyMap, getInversionResult, getSignalData, getSimulationResults, getUncertainty, reportUrl } from '../api/analysis'
import { ApiError } from '../api/errors'
import { getExperiment } from '../api/experiments'
import { getMeasurements, getSimulationStatus, getSurveyPlan, listSimulations } from '../api/simulations'
import { usePublishExperiment } from '../app/providers/shellContext'
import { Button } from '../components/controls/Button'
import { ErrorBoundary } from '../components/feedback/ErrorBoundary'
import { Banner, EmptyState, ErrorState, Skeleton } from '../components/feedback/States'
import { Page, PageHeader, Panel, Section } from '../components/layout/Page'
import { AnomalyMap } from '../features/analysis/AnomalyMap'
import { NoiseBudget } from '../features/analysis/NoiseBudget'
import { AnalysisChain, ResultSummary } from '../features/analysis/ResultSummary'
import { SignalChart } from '../features/analysis/SignalChart'
import { ComparisonSection } from '../features/inversion/ComparisonSection'
import { ErrorMetrics } from '../features/inversion/ErrorMetrics'
import { MeasurementBuffer } from '../features/simulation/measurementBuffer'
import { SceneView } from '../features/survey/SceneView'
import { UncertaintySection } from '../features/uncertainty/UncertaintySection'
import type { Resource } from '../hooks/useResource'
import { useResource } from '../hooks/useResource'
import type { EstimateMarker } from '../three/Estimates'
import type { ResultEnvelope, SimulationStatusDoc } from '../types/api'
import { formatDateTime, formatInteger } from '../utils/format'
import { shortHash } from '../utils/misc'
import { NoExperiment } from './NoExperiment'
import styles from './pages.module.css'

const ID = /^[0-9a-f]{32}$/

/** Renders one independently loaded section with its own loading and error states. */
function Loaded<T>({ resource, height, children }: { resource: Resource<T> & { reload: () => void }; height: number; children: (data: T) => ReactNode }) {
  if (resource.status === 'ready') return <>{children(resource.data)}</>
  if (resource.status === 'error') {
    return <ErrorState compact headingLevel={3} error={resource.error} actions={<Button size="sm" onClick={resource.reload}>Retry</Button>} />
  }
  return <Skeleton height={height} label="Loading section" />
}

/** Guards against a response that belongs to a different simulation than the one requested. */
function sameRun<T extends ResultEnvelope>(simulationId: string) {
  return (data: T): T => {
    if (data.simulation_id !== simulationId) {
      throw new ApiError('parse', 'The engine returned results for a different simulation.', { code: 'inconsistent_response' })
    }
    return data
  }
}

function StatusExplanation({ status, experimentId }: { status: SimulationStatusDoc; experimentId: string }) {
  const simHref = `/experiments/${experimentId}/simulation`
  if (status.status === 'failed') {
    return (
      <ErrorState
        error={{
          title: 'This simulation failed',
          message: status.error?.message ?? 'No reason was reported.',
          code: status.error?.code ?? 'simulation_error',
          retryable: true,
          engineUnavailable: false,
          fields: [],
        }}
        actions={<Link to={simHref}>Open simulation</Link>}
      />
    )
  }
  if (status.status === 'cancelled') {
    return (
      <EmptyState
        title="This simulation was cancelled."
        message={`Partial simulation: ${formatInteger(status.measurements_completed)} of ${formatInteger(status.measurements_total)} measurements were recorded. Analysis results are produced only by completed simulations.`}
        actions={
          <>
            <a className={styles.secondaryLink} href={exportUrl(status.id, 'csv')} download>
              <Download aria-hidden="true" /> Export partial CSV
            </a>
            <Link className={styles.primaryLink} to={simHref}>
              Run again
            </Link>
          </>
        }
      />
    )
  }
  return (
    <EmptyState
      title="Simulation in progress."
      message={`Results appear when the simulation completes (currently ${Math.round(status.progress * 100)} %).`}
      actions={
        <Link className={styles.primaryLink} to={simHref}>
          Watch the simulation
        </Link>
      }
    />
  )
}

function AnalysisView({ experimentId }: { experimentId: string }) {
  const [params, setParams] = useSearchParams()
  const requested = params.get('simulation')
  const requestedId = requested !== null && ID.test(requested) ? requested : null

  const experiment = useResource(experimentId, (signal) => getExperiment(experimentId, signal), 'Experiment unavailable')
  const exp = experiment.status === 'ready' ? experiment.data : null
  usePublishExperiment(exp ? { id: exp.id, code: exp.code, name: exp.name } : null)
  const runs = useResource(exp ? `${exp.id}:${exp.latest_simulation?.id ?? ''}` : null, (signal) => listSimulations(experimentId, signal), 'Runs unavailable')

  const simId = requestedId ?? exp?.latest_simulation?.id ?? null
  const status = useResource(simId, (signal) => getSimulationStatus(simId ?? '', signal), 'Simulation unavailable')
  const doc = status.status === 'ready' ? status.data : null
  const key = doc !== null && doc.status === 'completed' && doc.results_available ? doc.id : null
  const id = key ?? ''

  const results = useResource(key, (s) => getSimulationResults(id, s).then(sameRun(id)), 'Results unavailable')
  const inversion = useResource(key, (s) => getInversionResult(id, s).then(sameRun(id)), 'Inversion result unavailable')
  const uncertainty = useResource(key, (s) => getUncertainty(id, s).then(sameRun(id)), 'Uncertainty unavailable')
  const anomalyMap = useResource(key, (s) => getAnomalyMap(id, s).then(sameRun(id)), 'Anomaly map unavailable')
  const signals = useResource(key, (s) => getSignalData(id, s).then(sameRun(id)), 'Signal data unavailable')
  const plan = useResource(key, (s) => getSurveyPlan(id, s), 'Survey plan unavailable')
  const measurements = useResource(
    key,
    async (s) => {
      const page = await getMeasurements(id, -1, s)
      const buffer = new MeasurementBuffer(Math.max(16, page.batch.rows.length))
      buffer.append(page.batch.rows)
      return { buffer, rejected: page.batch.rejected, total: page.total }
    },
    'Measurements unavailable',
  )

  const estimates = useMemo((): EstimateMarker[] | undefined => {
    if (inversion.status !== 'ready' || uncertainty.status !== 'ready') return undefined
    return inversion.data.data.sources.map((s) => {
      const p = uncertainty.data.data.sources.find((u) => u.source_id === s.id)?.parameters
      const range = (lo: number | null | undefined, hi: number | null | undefined): readonly [number, number] | null =>
        typeof lo === 'number' && typeof hi === 'number' ? [lo, hi] : null
      const x = range(p?.x_m.ci_low, p?.x_m.ci_high)
      const y = range(p?.y_m.ci_low, p?.y_m.ci_high)
      const depth = range(p?.depth_m.ci_low, p?.depth_m.ci_high)
      return {
        id: s.id,
        x_m: s.x_m.estimate,
        y_m: s.y_m.estimate,
        depth_m: s.depth_m.estimate,
        // Drawn only when the engine supplied every bound; never filled with placeholder values.
        interval: x && y && depth ? { x_m: x, y_m: y, depth_m: depth } : null,
        // One detection test covers all sources: is any buried mass present at all?
        detected: inversion.data.data.detection.anomaly_detected,
      }
    })
  }, [inversion, uncertainty])

  if (experiment.status === 'error') {
    return (
      <Page label="Analysis">
        <PageHeader title="Analysis" />
        <ErrorState error={experiment.error} actions={<Button onClick={experiment.reload}>Retry</Button>} />
      </Page>
    )
  }
  if (exp === null) {
    return (
      <Page label="Analysis">
        <PageHeader title="Analysis" meta="Loading…" />
        <Skeleton height={360} label="Loading analysis" />
      </Page>
    )
  }

  const header = (meta?: ReactNode, actions?: ReactNode) => (
    <PageHeader title="Analysis" eyebrow={`${exp.code} · ${exp.name}`} meta={meta} actions={actions} />
  )

  if (simId === null) {
    return (
      <Page label="Analysis">
        {header()}
        <EmptyState
          title="No simulation has been run for this experiment."
          message="Run the simulation to generate measurements, an anomaly map, an inverse reconstruction and uncertainty estimates."
          actions={
            <Link className={styles.primaryLink} to={`/experiments/${exp.id}/simulation`}>
              Open simulation
            </Link>
          }
        />
      </Page>
    )
  }
  if (status.status === 'error') {
    return (
      <Page label="Analysis">
        {header()}
        <ErrorState error={status.error} actions={<Button onClick={status.reload}>Retry</Button>} />
      </Page>
    )
  }
  if (doc === null) {
    return (
      <Page label="Analysis">
        {header('Loading simulation…')}
        <Skeleton height={360} label="Loading simulation status" />
      </Page>
    )
  }

  const completedRuns = runs.status === 'ready' ? runs.data.filter((r) => r.status === 'completed') : []
  const runSelector =
    completedRuns.length > 1 ? (
      <label className={styles.runSelect}>
        <span>Run</span>
        <select
          value={doc.id}
          onChange={(event) => {
            setParams({ simulation: event.target.value })
          }}
        >
          {completedRuns.map((r) => (
            <option key={r.id} value={r.id}>
              {formatDateTime(r.completed_at ?? r.created_at)} · v{r.experiment_version} · {shortHash(r.id)}
            </option>
          ))}
        </select>
      </label>
    ) : null

  if (key === null) {
    return (
      <Page label="Analysis">
        {header(runSelector)}
        <StatusExplanation status={doc} experimentId={exp.id} />
      </Page>
    )
  }

  const stale = doc.configuration_hash !== exp.configuration_hash
  const exportName = `${exp.code}-${shortHash(doc.id)}`
  const buffer = measurements.status === 'ready' ? measurements.data.buffer : null
  const processed = signals.status === 'ready' ? signals.data.data : null

  return (
    <Page label="Analysis">
      {header(
        <>
          <span>Completed {formatDateTime(doc.completed_at ?? doc.updated_at)}</span>
          <span className={styles.metaCode}>run {shortHash(doc.id)}</span>
          <span>configuration v{doc.experiment_version}</span>
          {runSelector}
        </>,
        <>
          <a className={styles.secondaryLink} href={exportUrl(doc.id, 'csv')} download>
            <Download aria-hidden="true" /> CSV
          </a>
          <a className={styles.secondaryLink} href={exportUrl(doc.id, 'json')} download>
            <Download aria-hidden="true" /> JSON
          </a>
          <a className={styles.primaryLink} href={reportUrl(doc.id)} download>
            <FileText aria-hidden="true" /> Scientific report
          </a>
        </>,
      )}

      {stale && (
        <Banner
          tone="warning"
          title="Result out of date"
          actions={
            <Link className={styles.secondaryLink} to={`/experiments/${exp.id}/simulation`}>
              Run again
            </Link>
          }
        >
          These results were produced with configuration version {doc.experiment_version}. The experiment has changed since (now version {exp.version}), so they do not describe the current configuration.
        </Banner>
      )}
      {measurements.status === 'ready' && measurements.data.rejected > 0 && (
        <Banner tone="warning" title="Measurements rejected">
          {formatInteger(measurements.data.rejected)} measurement rows failed validation and are excluded from the charts.
        </Banner>
      )}

      <Loaded resource={results} height={180}>
        {(r) => (
          <>
            <ResultSummary results={r} inversion={inversion.status === 'ready' ? inversion.data.data : null} />
            <AnalysisChain results={r} inversion={inversion.status === 'ready' ? inversion.data.data : null} buffer={buffer} />
          </>
        )}
      </Loaded>

      <Section id="reconstruction" number="01" title="3D reconstruction" description="Estimated sources with their 95 % regions, drawn against the configured bodies (ground truth, wireframe).">
        <Loaded resource={plan} height={420}>
          {(p) => (
            <SceneView
              plan={p}
              planError={null}
              mode="reconstruction"
              estimates={estimates ?? []}
              description={`3D reconstruction with ${estimates?.length ?? 0} estimated sources and ${p.bodies.length} configured bodies.`}
              resetKey={doc.id}
              className={styles.sceneBox}
            />
          )}
        </Loaded>
      </Section>

      <Section id="anomaly-map-section" number="02" title="Gravity anomaly map" description="Spatial pattern of the anomaly over the survey grid. Click a cell to inspect it.">
        <Panel>
          <Loaded resource={anomalyMap} height={440}>
            {(m) =>
              results.status === 'ready' && inversion.status === 'ready' ? (
                <ErrorBoundary region="Anomaly map">
                  <AnomalyMap map={m.data} sources={inversion.data.data.sources} truth={results.data.ground_truth.bodies} exportName={`${exportName}-map`} />
                </ErrorBoundary>
              ) : (
                <Skeleton height={440} label="Loading map context" />
              )
            }
          </Loaded>
        </Panel>
      </Section>

      <Section id="frequency" number="03" title="Frequency shift" description="The full dataset from the survey with the inversion model. Switch signals to follow the chain from potential to processed data.">
        <Panel>
          <Loaded resource={measurements} height={320}>
            {(m) => (
              <SignalChart id="analysis-signal" source={{ buffer: m.buffer, count: m.buffer.length, processed }} live={false} exportName={`${exportName}-signal`} />
            )}
          </Loaded>
        </Panel>
      </Section>

      <Section id="signal-noise" number="04" title="Signal and noise" description="How large the anomaly is compared with each noise source, and the injected noise itself.">
        <Panel>
          <Loaded resource={results} height={300}>
            {(r) => <NoiseBudget components={r.noise_budget.components} nominalSigma={r.noise_budget.nominal_sigma} comparison={r.comparison} exportName={exportName} />}
          </Loaded>
        </Panel>
        <Panel>
          <Loaded resource={measurements} height={300}>
            {(m) => (
              <SignalChart id="noise-signal" initialSignal="noise" source={{ buffer: m.buffer, count: m.buffer.length, processed }} live={false} exportName={`${exportName}-noise`} />
            )}
          </Loaded>
        </Panel>
      </Section>

      <Section id="comparison" number="05" title="Ground truth vs estimation" description="The configured bodies are known only to the simulator; the estimate comes from the measurements alone.">
        {results.status === 'ready' && inversion.status === 'ready' && uncertainty.status === 'ready' ? (
          <ComparisonSection
            comparison={results.data.comparison}
            truth={results.data.ground_truth.bodies}
            sources={inversion.data.data.sources}
            uncertainty={uncertainty.data.data}
            exportName={exportName}
          />
        ) : (
          <Loaded resource={results.status !== 'ready' ? results : inversion.status !== 'ready' ? inversion : uncertainty} height={300}>
            {() => null}
          </Loaded>
        )}
      </Section>

      <Section id="metrics" number="06" title="Error metrics" description="Computed by the engine from ground truth and estimates.">
        {results.status === 'ready' && inversion.status === 'ready' ? (
          <ErrorMetrics comparison={results.data.comparison} inversion={inversion.data.data} />
        ) : (
          <Loaded resource={results.status !== 'ready' ? results : inversion} height={200}>
            {() => null}
          </Loaded>
        )}
      </Section>

      <Section id="uncertainty" number="07" title="Uncertainty" description="Bootstrap distributions and confidence intervals for each estimated parameter.">
        {results.status === 'ready' && uncertainty.status === 'ready' ? (
          <UncertaintySection uncertainty={uncertainty.data.data} comparison={results.data.comparison} truth={results.data.ground_truth.bodies} exportName={exportName} />
        ) : (
          <Loaded resource={results.status !== 'ready' ? results : uncertainty} height={300}>
            {() => null}
          </Loaded>
        )}
      </Section>
    </Page>
  )
}

export default function AnalysisPage() {
  const { experimentId } = useParams()
  if (experimentId === undefined) return <NoExperiment page="analysis" />
  return <AnalysisView key={experimentId} experimentId={experimentId} />
}
