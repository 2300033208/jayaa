import { Play, Square } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { getExperiment } from '../api/experiments'
import { usePublishExperiment } from '../app/providers/shellContext'
import { Button } from '../components/controls/Button'
import { SegmentedField } from '../components/controls/Choice'
import { Field } from '../components/controls/Field'
import { describedBy } from '../components/controls/fieldA11y'
import { NumberInput } from '../components/controls/NumberField'
import { ErrorBoundary } from '../components/feedback/ErrorBoundary'
import { Banner, EmptyState, ErrorState, Skeleton } from '../components/feedback/States'
import { Page, PageHeader } from '../components/layout/Page'
import { ProgressBar } from '../components/simulation/ProgressBar'
import { RepeatView, SweepView, TimeLapseView } from '../features/study/StudyResults'
import { isActiveStudy, useStudies } from '../features/study/useStudies'
import { useResource } from '../hooks/useResource'
import type { Experiment } from '../types/api'
import type { Study, StudyKind, StudyRequest } from '../types/studies'
import { formatDateTime } from '../utils/format'
import { formatQuantity } from '../utils/units'
import { NoExperiment } from './NoExperiment'
import styles from '../features/study/study.module.css'

const KIND_LABEL: Record<StudyKind, string> = {
  repeat: 'Repeat experiment',
  sweep: 'Mass × depth sweep',
  time_lapse: 'Time-lapse change',
}

const KIND_HINT: Record<StudyKind, string> = {
  repeat: 'The configured campaign with many noise realizations: detection rate, estimation bias and whether the 95 % intervals contain the truth.',
  sweep: 'Detection probability of the first body over a grid of masses and depths, next to the analytic prediction.',
  time_lapse: 'Two surveys of the same stations with a mass change in between (e.g. groundwater depletion): can the change be detected?',
}

/** Log-spaced axis values between two bounds (inclusive), for the sweep grid. */
function logAxis(low: number, high: number, count: number): number[] {
  if (!(low > 0 && high > low && count >= 2)) return []
  const step = Math.log(high / low) / (count - 1)
  return Array.from({ length: count }, (_, i) => Number((low * Math.exp(step * i)).toPrecision(3)))
}

function NumberSetting(props: { id: string; label: string; value: number; onChange: (v: number) => void; unit?: string; error?: string | undefined; hint?: string; disabled?: boolean }) {
  const { id, label, value, onChange, unit, error, hint, disabled } = props
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <NumberInput id={id} value={value} onChange={onChange} unit={unit} disabled={disabled} invalid={Boolean(error)} describedBy={describedBy(id, { error, hint })} />
    </Field>
  )
}

function StudyForm({ experiment, busy, fieldErrors, onStart }: { experiment: Experiment; busy: boolean; fieldErrors: Record<string, string>; onStart: (r: StudyRequest) => void }) {
  const body = experiment.config.bodies[0]
  const mass = Math.abs(body?.mass_kg ?? 1e12)
  const depth = body?.depth_m ?? 1000
  const [kind, setKind] = useState<StudyKind>('repeat')
  const [runs, setRuns] = useState(50)
  const [massLow, setMassLow] = useState(Math.max(1e6, mass / 100))
  const [massHigh, setMassHigh] = useState(Math.min(1e15, mass * 10))
  const [massCount, setMassCount] = useState(5)
  const [depthLow, setDepthLow] = useState(Math.max(experiment.config.survey.spacing_m / 2, depth / 4))
  const [depthHigh, setDepthHigh] = useState(Math.min(20_000, depth * 3))
  const [depthCount, setDepthCount] = useState(4)
  const [change, setChange] = useState(-0.2 * mass)
  const [intervalDays, setIntervalDays] = useState(365)

  const masses = logAxis(massLow, massHigh, Math.round(massCount))
  const depths = logAxis(depthLow, depthHigh, Math.round(depthCount))
  const request: StudyRequest =
    kind === 'repeat'
      ? { kind, runs }
      : kind === 'sweep'
        ? { kind, runs, masses_kg: masses, depths_m: depths }
        : { kind, runs, mass_change_kg: change, interval_days: intervalDays }
  const localError =
    !Number.isInteger(runs) || runs < 5 || runs > 500
      ? 'Runs must be a whole number from 5 to 500.'
      : kind === 'sweep' && (masses.length === 0 || depths.length === 0)
        ? 'Each range needs a lower bound below its upper bound and at least 2 values.'
        : null

  return (
    <section className={styles.panel} aria-labelledby="study-form-title">
      <h2 id="study-form-title">New study</h2>
      <SegmentedField
        id="field-study-kind"
        label="Study"
        value={kind}
        options={(Object.keys(KIND_LABEL) as StudyKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
        onChange={(next) => {
          setKind(next)
          setRuns(next === 'sweep' ? 20 : next === 'time_lapse' ? 30 : 50)
        }}
        hint={KIND_HINT[kind]}
        disabled={busy}
      />
      <NumberSetting
        id="field-study-runs"
        label={kind === 'sweep' ? 'Runs per cell' : 'Runs'}
        value={runs}
        onChange={setRuns}
        error={fieldErrors.runs}
        hint="More runs narrow the 95 % intervals of the rates."
        disabled={busy}
      />
      {kind === 'sweep' && (
        <>
          <div className={styles.inline}>
            <NumberSetting id="field-study-mass-low" label="Mass from" value={massLow} onChange={setMassLow} unit="kg" disabled={busy} />
            <NumberSetting id="field-study-mass-high" label="Mass to" value={massHigh} onChange={setMassHigh} unit="kg" disabled={busy} />
            <NumberSetting id="field-study-mass-count" label="Values" value={massCount} onChange={setMassCount} error={fieldErrors.masses_kg} disabled={busy} />
          </div>
          <div className={styles.inline}>
            <NumberSetting id="field-study-depth-low" label="Depth from" value={depthLow} onChange={setDepthLow} unit="m" disabled={busy} />
            <NumberSetting id="field-study-depth-high" label="Depth to" value={depthHigh} onChange={setDepthHigh} unit="m" disabled={busy} />
            <NumberSetting id="field-study-depth-count" label="Values" value={depthCount} onChange={setDepthCount} error={fieldErrors.depths_m} disabled={busy} />
          </div>
        </>
      )}
      {kind === 'time_lapse' && (
        <>
          <NumberSetting
            id="field-study-change"
            label="Mass change of the first body"
            value={change}
            onChange={setChange}
            unit="kg"
            error={fieldErrors.mass_change_kg}
            hint={`Negative for loss (e.g. aquifer depletion). Configured mass: ${formatQuantity(mass, 'mass', { significant: 2 })}.`}
            disabled={busy}
          />
          <NumberSetting id="field-study-interval" label="Time between surveys" value={intervalDays} onChange={setIntervalDays} unit="d" error={fieldErrors.interval_days} disabled={busy} />
        </>
      )}
      {localError && (
        <p className={styles.note} role="status">
          {localError}
        </p>
      )}
      <Button
        variant="primary"
        icon={<Play />}
        busy={busy}
        disabled={busy || localError !== null}
        onClick={() => {
          onStart(request)
        }}
      >
        Start study
      </Button>
    </section>
  )
}

function StudyHistory({ list, selectedId, onSelect, currentHash }: { list: Study[]; selectedId: string | null; onSelect: (id: string) => void; currentHash: string }) {
  if (list.length === 0) return <p className={styles.note}>No studies yet for this experiment.</p>
  return (
    <ul className={styles.history} aria-label="Studies of this experiment">
      {list.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            aria-current={s.id === selectedId}
            onClick={() => {
              onSelect(s.id)
            }}
          >
            <span>
              {KIND_LABEL[s.kind]} · {s.request.runs} runs
            </span>
            <span className={styles.historyMeta}>
              {s.status} · {formatDateTime(s.created_at)}
              {s.configuration_hash !== currentHash && ' · out of date'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function SelectedStudy({ study, currentHash, onCancel, exportName }: { study: Study; currentHash: string; onCancel: () => void; exportName: string }) {
  const outOfDate = study.configuration_hash !== currentHash
  return (
    <section className={styles.main} aria-labelledby="study-title" aria-busy={isActiveStudy(study)}>
      <div className={styles.statusRow}>
        <h2 id="study-title">
          {KIND_LABEL[study.kind]} <span className={styles.muted}>· started {formatDateTime(study.created_at)}</span>
        </h2>
        {isActiveStudy(study) && (
          <Button icon={<Square />} onClick={onCancel}>
            Cancel study
          </Button>
        )}
      </div>
      {outOfDate && (
        <Banner tone="warning" title="RESULT OUT OF DATE">
          The experiment configuration changed after this study ran. Start a new study to evaluate the current configuration.
        </Banner>
      )}
      {isActiveStudy(study) && <ProgressBar value={study.progress} label={`Study progress ${Math.round(study.progress * 100)} %`} />}
      {study.status === 'failed' && study.error && (
        <ErrorState
          compact
          error={{ title: 'Study failed', message: study.error.message, code: study.error.code, retryable: true, engineUnavailable: false, fields: [] }}
        />
      )}
      {study.status === 'cancelled' && <Banner tone="info" title="Study cancelled">No result was kept. Start the study again to complete it.</Banner>}
      {study.status === 'completed' && study.result && (
        <ErrorBoundary region="Study results">
          {study.result.kind === 'repeat' ? (
            <RepeatView result={study.result} exportName={exportName} />
          ) : study.result.kind === 'sweep' ? (
            <SweepView result={study.result} exportName={exportName} />
          ) : (
            <TimeLapseView result={study.result} exportName={exportName} />
          )}
        </ErrorBoundary>
      )}
    </section>
  )
}

function StudyPageFor({ experimentId }: { experimentId: string }) {
  const experiment = useResource(experimentId, (signal) => getExperiment(experimentId, signal), 'Experiment unavailable')
  const exp = experiment.status === 'ready' ? experiment.data : null
  usePublishExperiment(exp ? { id: exp.id, code: exp.code, name: exp.name } : null)
  const studies = useStudies(experimentId)
  const selectedId = studies.selected?.id ?? null
  const exportName = useMemo(() => (exp ? `${exp.code.toLowerCase()}-study` : 'study'), [exp])

  if (experiment.status === 'error') {
    return (
      <Page label="Monte Carlo study">
        <PageHeader title="Study" />
        <ErrorState error={experiment.error} actions={<Button onClick={experiment.reload}>Retry</Button>} />
      </Page>
    )
  }
  if (exp === null) {
    return (
      <Page label="Monte Carlo study">
        <PageHeader title="Study" meta="Loading experiment…" />
        <Skeleton height={320} label="Loading experiment" />
      </Page>
    )
  }
  const running = studies.selected !== null && isActiveStudy(studies.selected)
  return (
    <Page label="Monte Carlo study">
      <PageHeader
        eyebrow={`${exp.code} · ${exp.name}`}
        title="Monte Carlo study"
        meta="Many simulated campaigns of this experiment, compared with the ground truth: how reliably is the mass detected and estimated?"
        actions={
          <Link className={styles.note} to={`/experiments/${exp.id}`}>
            Configuration
          </Link>
        }
      />
      {studies.startError && <ErrorState compact error={studies.startError} />}
      <div className={styles.layout}>
        <div className={styles.main}>
          <StudyForm experiment={exp} busy={studies.starting || running} fieldErrors={studies.fieldErrors} onStart={(r) => void studies.start(r)} />
          <section className={styles.panel} aria-labelledby="study-history-title">
            <h2 id="study-history-title">Previous studies</h2>
            {studies.listError ? (
              <ErrorState compact error={studies.listError} actions={<Button onClick={studies.reloadList}>Retry</Button>} />
            ) : studies.list === null ? (
              <Skeleton height={80} label="Loading studies" />
            ) : (
              <StudyHistory list={studies.list} selectedId={selectedId} onSelect={studies.select} currentHash={exp.configuration_hash} />
            )}
          </section>
        </div>
        <div className={styles.main}>
          {studies.selectedError && <ErrorState compact error={studies.selectedError} />}
          {studies.selected ? (
            <SelectedStudy study={studies.selected} currentHash={exp.configuration_hash} onCancel={() => void studies.cancel()} exportName={exportName} />
          ) : (
            studies.list !== null &&
            studies.list.length === 0 && (
              <EmptyState title="No study yet." message="Choose a study type and start it; results appear here as soon as it finishes." />
            )
          )}
        </div>
      </div>
    </Page>
  )
}

export default function StudyPage() {
  const { experimentId } = useParams()
  if (experimentId === undefined) return <NoExperiment page="study" />
  return <StudyPageFor key={experimentId} experimentId={experimentId} />
}
