import { Play, Save } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams } from 'react-router'
import { usePublishExperiment } from '../app/providers/shellContext'
import { Button } from '../components/controls/Button'
import { ConfirmDialog } from '../components/feedback/ConfirmDialog'
import { ErrorBoundary } from '../components/feedback/ErrorBoundary'
import { Banner, ErrorState, Skeleton } from '../components/feedback/States'
import { Page, PageHeader } from '../components/layout/Page'
import { ConfigPreview } from '../features/experiment/ConfigPreview'
import { DesignAssistant } from '../features/experiment/DesignAssistant'
import { DetectabilitySection } from '../features/experiment/Detectability'
import { fieldId } from '../features/experiment/fieldId'
import { EnvironmentSection } from '../features/experiment/sections/EnvironmentSection'
import { InversionSection } from '../features/experiment/sections/InversionSection'
import { NoiseSection } from '../features/experiment/sections/NoiseSection'
import { SensorSection } from '../features/experiment/sections/SensorSection'
import { SubsurfaceSection } from '../features/experiment/sections/SubsurfaceSection'
import { SurveySection } from '../features/experiment/sections/SurveySection'
import { ScenarioPicker } from '../features/experiment/ScenarioPicker'
import { useBackendValidation } from '../features/experiment/useBackendValidation'
import { useDetectability } from '../features/experiment/useDetectability'
import { useExperimentDraft } from '../features/experiment/useExperimentDraft'
import type { SectionId } from '../features/experiment/validation'
import { sectionErrorCount } from '../features/experiment/validation'
import { InstrumentComparisonSection } from '../features/research/InstrumentComparison'
import { useInstrumentComparison } from '../features/research/useInstrumentComparison'
import type { AutostartState } from '../features/simulation/navigation'
import type { GravimeterKind } from '../types/research'
import { formatDateTime } from '../utils/format'
import { newId } from '../utils/misc'
import styles from '../features/experiment/experiment.module.css'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'environment', label: 'Environment' },
  { id: 'subsurface', label: 'Subsurface' },
  { id: 'sensor', label: 'Sensor' },
  { id: 'noise', label: 'Noise' },
  { id: 'survey', label: 'Survey' },
  { id: 'inversion', label: 'Inversion' },
]

const ACTIVE_RUN = new Set(['starting', 'running', 'paused', 'cancelling'])

function elementFor(path: string): HTMLElement | null {
  const candidates = [path, path.split('.').slice(0, 2).join('.'), path.split('.')[0] ?? path]
  for (const candidate of candidates) {
    const el = document.getElementById(fieldId(candidate)) ?? document.getElementById(candidate)
    if (el) return el
  }
  return null
}

/** The invalid field that appears first in the form, so focus lands where the user reads first. */
function firstInDocumentOrder(paths: readonly string[]): string | undefined {
  const located = paths.flatMap((path) => {
    const el = elementFor(path)
    return el ? [{ path, el }] : []
  })
  located.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  return located[0]?.path ?? paths[0]
}

function jumpTo(path: string) {
  const candidates = [path, path.split('.').slice(0, 2).join('.'), path.split('.')[0] ?? path]
  for (const candidate of candidates) {
    const el = document.getElementById(fieldId(candidate)) ?? document.getElementById(candidate)
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.focus({ preventScroll: true })
      else {
        const focusable = el.querySelector<HTMLElement>('input, select, button')
        focusable?.focus({ preventScroll: true })
      }
      return
    }
  }
}

function ExperimentEditor({ experimentId }: { experimentId: string | null }) {
  const navigate = useNavigate()
  const { state, clientErrors, dirty, edit, save, reload } = useExperimentDraft(experimentId)
  const clientValid = Object.keys(clientErrors).length === 0
  const validation = useBackendValidation(state.draft, clientValid)
  const detectability = useDetectability(state.draft, validation.status === 'done' && validation.result.valid)
  const [gravimeter, setGravimeter] = useState<GravimeterKind>('relative')
  const instruments = useInstrumentComparison(state.draft, validation.status === 'done' && validation.result.valid, gravimeter)
  const leaving = useRef(false)
  const experiment = state.experiment
  const latest = experiment?.latest_simulation ?? null
  const locked = latest !== null && ACTIVE_RUN.has(latest.status)

  usePublishExperiment(experiment ? { id: experiment.id, code: experiment.code, name: experiment.name } : null)

  const errors = useMemo(() => {
    const merged: Record<string, string> = {}
    if (validation.status === 'done' && !validation.result.valid) {
      for (const f of validation.result.errors) merged[f.field] ??= f.message
    }
    for (const f of state.serverFieldErrors) merged[f.field] ??= f.message
    return { ...merged, ...clientErrors }
  }, [validation, state.serverFieldErrors, clientErrors])

  const warnings = useMemo(() => {
    const out: Record<string, string> = {}
    const result = validation.status === 'done' ? validation.result : null
    for (const w of result?.warnings ?? []) out[w.field] ??= w.message
    return out
  }, [validation])

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname)

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [dirty])

  const onSave = useCallback(async () => {
    if (!clientValid) {
      const first = firstInDocumentOrder(Object.keys(clientErrors))
      if (first) jumpTo(first)
      return
    }
    const saved = await save()
    if (saved && experimentId === null) {
      leaving.current = true
      void navigate(`/experiments/${saved.id}`, { replace: true })
    }
  }, [clientValid, clientErrors, save, experimentId, navigate])

  const onRun = useCallback(async () => {
    if (!clientValid) {
      const first = firstInDocumentOrder(Object.keys(clientErrors))
      if (first) jumpTo(first)
      return
    }
    let target = experiment
    if (dirty || target === null) {
      target = await save()
      if (target === null) return
    }
    leaving.current = true
    const navState: AutostartState = { autostart: { key: newId(), playback: 'normal' } }
    void navigate(`/experiments/${target.id}/simulation`, { state: navState })
  }, [clientValid, clientErrors, experiment, dirty, save, navigate])

  if (state.status === 'loading') {
    return (
      <Page label="Experiment">
        <PageHeader title={experimentId ? 'Experiment' : 'New experiment'} meta="Loading configuration…" />
        <Skeleton height={420} label="Loading experiment configuration" />
      </Page>
    )
  }
  if (state.status === 'error' || state.draft === null) {
    return (
      <Page label="Experiment">
        <PageHeader title={experimentId ? 'Experiment' : 'New experiment'} />
        {state.loadError && (
          <ErrorState
            error={state.loadError}
            actions={
              <>
                <Button onClick={reload}>Retry</Button>
                <Link to="/history">Open experiment history</Link>
              </>
            }
          />
        )}
      </Page>
    )
  }

  const config = state.draft
  const sectionProps = { config, edit, errors, warnings, disabled: locked || state.saving }
  const saveLabel = state.saving
    ? 'Saving…'
    : experiment === null
      ? 'Not saved yet'
      : dirty
        ? 'Unsaved changes'
        : `Saved · version ${experiment.version}`

  return (
    <Page label="Experiment configuration">
      <PageHeader
        title={experiment ? experiment.code : 'New experiment'}
        eyebrow="Experiment"
        meta={
          <span className={styles.saveState} data-dirty={dirty} role="status">
            {saveLabel}
            {experiment && !dirty && ` · updated ${formatDateTime(experiment.updated_at)}`}
          </span>
        }
        actions={
          <>
            <Button icon={<Save />} onClick={() => void onSave()} busy={state.saving} disabled={locked || (!dirty && experiment !== null)}>
              Save
            </Button>
            <Button variant="primary" icon={<Play />} onClick={() => void onRun()} disabled={locked || state.saving}>
              Run simulation
            </Button>
          </>
        }
      />

      <div className={styles.nameField}>
        <label htmlFor="field-name">Experiment name</label>
        <input
          id="field-name"
          className={styles.nameInput}
          value={config.name}
          maxLength={200}
          disabled={locked}
          aria-invalid={Boolean(errors.name) || undefined}
          aria-describedby={errors.name ? 'field-name-error' : undefined}
          onChange={(event) => {
            const name = event.target.value
            edit((c) => ({ ...c, name }))
          }}
        />
        {errors.name && (
          <p id="field-name-error" role="alert" className={styles.nameError}>
            {errors.name}
          </p>
        )}
      </div>

      {locked && (
        <Banner
          tone="info"
          title="Simulation in progress"
          actions={<Link to={`/experiments/${experiment?.id ?? ''}/simulation`}>Open simulation</Link>}
        >
          The configuration is locked while a simulation runs for this experiment.
        </Banner>
      )}
      {!locked && dirty && latest?.status === 'completed' && (
        <Banner tone="warning" title="Previous result will be out of date">
          Saving these changes creates a new configuration version. The result from {formatDateTime(latest.completed_at ?? latest.created_at)} will be kept but marked as out of date.
        </Banner>
      )}
      {state.saveError && (
        <ErrorState
          compact
          error={state.saveError}
          actions={state.saveError.code === 'version_conflict' ? <Button onClick={reload}>Reload experiment</Button> : undefined}
        />
      )}

      <div className={styles.layout}>
        <div className={styles.form}>
          {state.scenarios && (
            <ScenarioPicker
              scenarios={state.scenarios}
              config={config}
              disabled={locked || state.saving}
              onApply={(next) => {
                edit(() => next)
              }}
            />
          )}
          <nav className={styles.sectionNav} aria-label="Configuration sections">
            {SECTIONS.map((s) => {
              const count = sectionErrorCount(errors, s.id)
              return (
                <a key={s.id} href={`#${s.id}`}>
                  {s.label}
                  {count > 0 && (
                    <span className={styles.navCount} aria-label={`${count} issues`}>
                      {count}
                    </span>
                  )}
                </a>
              )
            })}
            <a href="#detectability">Detectability</a>
            <a href="#instruments">Instruments</a>
            <a href="#design">Design</a>
          </nav>
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
            }}
          >
            <EnvironmentSection {...sectionProps} />
            <SubsurfaceSection {...sectionProps} />
            <SensorSection {...sectionProps} />
            <NoiseSection {...sectionProps} />
            <SurveySection {...sectionProps} />
            <InversionSection {...sectionProps} />
          </form>
          <ErrorBoundary region="Detectability study">
            <DetectabilitySection state={detectability} />
          </ErrorBoundary>
          <ErrorBoundary region="Clock and gravimeter comparison">
            <InstrumentComparisonSection state={instruments} gravimeter={gravimeter} onGravimeterChange={setGravimeter} />
          </ErrorBoundary>
          <ErrorBoundary region="Survey design assistant">
            <DesignAssistant
              config={config}
              ready={validation.status === 'done' && validation.result.valid}
              disabled={locked || state.saving}
              onApply={(design) => {
                edit((c) => ({
                  ...c,
                  survey: { ...c.survey, spacing_m: design.spacing_m },
                  sensor: { ...c.sensor, measurement_interval_s: design.averaging_time_s },
                }))
                jumpTo('survey.spacing_m')
              }}
            />
          </ErrorBoundary>
        </div>
        <aside className={styles.aside} aria-label="Configuration summary">
          <ErrorBoundary region="Configuration preview">
            <ConfigPreview config={config} clientErrors={clientErrors} validation={validation} onJump={jumpTo} />
          </ErrorBoundary>
        </aside>
      </div>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Discard unsaved changes?"
        confirmLabel="Discard changes"
        tone="danger"
        onConfirm={() => {
          blocker.proceed?.()
        }}
        onCancel={() => {
          blocker.reset?.()
        }}
      >
        The configuration has changes that are not saved. Leaving now discards them.
      </ConfirmDialog>
    </Page>
  )
}

export default function ExperimentPage() {
  const { experimentId } = useParams()
  const id = experimentId ?? null
  return <ExperimentEditor key={id ?? 'new'} experimentId={id} />
}
