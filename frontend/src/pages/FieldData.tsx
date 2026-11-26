import { RefreshCw, Square, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { getSimulationResults } from '../api/analysis'
import { getExperiment } from '../api/experiments'
import { usePublishExperiment } from '../app/providers/shellContext'
import { Button } from '../components/controls/Button'
import { ConfirmDialog } from '../components/feedback/ConfirmDialog'
import { ErrorBoundary } from '../components/feedback/ErrorBoundary'
import { Banner, EmptyState, ErrorState, Skeleton } from '../components/feedback/States'
import { Page, PageHeader } from '../components/layout/Page'
import { ProgressBar } from '../components/simulation/ProgressBar'
import { FieldResultsView } from '../features/field/FieldResultsView'
import { UploadForm } from '../features/field/UploadForm'
import type { DatasetsState } from '../features/field/useDatasets'
import { useDatasets } from '../features/field/useDatasets'
import { useResource } from '../hooks/useResource'
import type { Experiment } from '../types/api'
import type { Dataset } from '../types/field'
import { formatDateTime, formatInteger } from '../utils/format'
import { formatQuantity } from '../utils/units'
import { NoExperiment } from './NoExperiment'
import styles from '../features/field/field.module.css'

const STATUS_TEXT: Record<Dataset['status'], string> = {
  analysing: 'analysing',
  ready: 'analysed',
  failed: 'analysis failed',
  cancelled: 'analysis cancelled',
}

function DatasetList({ list, selectedId, onSelect, currentHash }: { list: Dataset[]; selectedId: string | null; onSelect: (id: string) => void; currentHash: string }) {
  if (list.length === 0) return <p className={styles.note}>No field data uploaded for this experiment yet.</p>
  return (
    <ul className={styles.history} aria-label="Field datasets of this experiment">
      {list.map((d) => (
        <li key={d.id}>
          <button
            type="button"
            aria-current={d.id === selectedId}
            onClick={() => {
              onSelect(d.id)
            }}
          >
            <span>{d.name}</span>
            <span className={styles.historyMeta}>
              {formatInteger(d.measurement_count)} measurements · {STATUS_TEXT[d.status]}
              {d.status === 'ready' && d.configuration_hash !== currentHash && ' · out of date'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function SelectedDataset({ experiment, data }: { experiment: Experiment; data: DatasetsState }) {
  const dataset = data.selected
  const [confirmDelete, setConfirmDelete] = useState(false)
  const latest = experiment.latest_simulation
  const simId = latest?.status === 'completed' && latest.results_available ? latest.id : null
  const simulation = useResource(
    simId,
    (signal) => {
      if (simId === null) throw new Error('No completed simulation to compare with')
      return getSimulationResults(simId, signal)
    },
    'Simulation results unavailable',
  )
  if (dataset === null) return null
  const outOfDate = dataset.status === 'ready' && dataset.configuration_hash !== experiment.configuration_hash
  const exportName = `${experiment.code.toLowerCase()}-field-${dataset.id.slice(0, 8)}`
  return (
    <section className={styles.column} aria-labelledby="field-dataset-title" aria-busy={dataset.status === 'analysing'}>
      <div className={styles.statusRow}>
        <h2 id="field-dataset-title">
          {dataset.name}{' '}
          <span className={styles.muted}>
            · {dataset.file_name} · {formatInteger(dataset.measurement_count)} measurements at {formatInteger(dataset.station_count)} stations ·{' '}
            {formatDateTime(dataset.start_utc)} to {formatDateTime(dataset.end_utc)}
          </span>
        </h2>
        <div className={styles.actions}>
          {dataset.status === 'analysing' ? (
            <Button icon={<Square aria-hidden="true" />} onClick={() => void data.cancel()}>
              Cancel analysis
            </Button>
          ) : (
            <Button icon={<RefreshCw aria-hidden="true" />} onClick={() => void data.reanalyse()}>
              Analyse again
            </Button>
          )}
          <Button
            variant="danger"
            icon={<Trash2 aria-hidden="true" />}
            onClick={() => {
              setConfirmDelete(true)
            }}
          >
            Delete
          </Button>
        </div>
      </div>
      {data.actionError && <ErrorState compact error={data.actionError} />}
      {outOfDate && (
        <Banner tone="warning" title="ANALYSIS OUT OF DATE">
          The experiment&rsquo;s site or analysis settings changed after this analysis. Analyse again to apply the current corrections.
        </Banner>
      )}
      {dataset.status === 'analysing' && <ProgressBar value={dataset.progress} label={`Analysis progress ${Math.round(dataset.progress * 100)} %`} />}
      {dataset.status === 'failed' && dataset.error && (
        <ErrorState
          compact
          error={{ title: 'Analysis failed', message: dataset.error.message, code: dataset.error.code, retryable: true, engineUnavailable: false, fields: [] }}
        />
      )}
      {dataset.status === 'cancelled' && <Banner tone="info" title="Analysis cancelled">Analyse the dataset again to see results.</Banner>}
      {data.resultsError && <ErrorState compact error={data.resultsError} />}
      {dataset.status === 'ready' && data.results === null && data.resultsError === null && <Skeleton height={320} label="Loading results" />}
      {dataset.status === 'ready' && data.results !== null && (
        <ErrorBoundary region="Field data results">
          {simulation.status === 'error' && <ErrorState compact error={simulation.error} />}
          <FieldResultsView
            results={data.results}
            simulation={simulation.status === 'ready' ? simulation.data : null}
            simulationCurrent={latest?.configuration_hash === experiment.configuration_hash}
            exportName={exportName}
          />
        </ErrorBoundary>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this dataset?"
        confirmLabel="Delete dataset"
        tone="danger"
        onConfirm={() => {
          setConfirmDelete(false)
          void data.remove()
        }}
        onCancel={() => {
          setConfirmDelete(false)
        }}
      >
        The uploaded measurements and their analysis are removed permanently. The experiment and its simulations stay.
      </ConfirmDialog>
    </section>
  )
}

function FieldDataFor({ experimentId }: { experimentId: string }) {
  const experiment = useResource(experimentId, (signal) => getExperiment(experimentId, signal), 'Experiment unavailable')
  const exp = experiment.status === 'ready' ? experiment.data : null
  usePublishExperiment(exp ? { id: exp.id, code: exp.code, name: exp.name } : null)
  const data = useDatasets(experimentId)

  if (experiment.status === 'error') {
    return (
      <Page label="Field data">
        <PageHeader title="Field data" />
        <ErrorState error={experiment.error} actions={<Button onClick={experiment.reload}>Retry</Button>} />
      </Page>
    )
  }
  if (exp === null) {
    return (
      <Page label="Field data">
        <PageHeader title="Field data" meta="Loading experiment…" />
        <Skeleton height={320} label="Loading experiment" />
      </Page>
    )
  }
  return (
    <Page label="Field data">
      <PageHeader
        eyebrow={`${exp.code} · ${exp.name}`}
        title="Field data"
        meta={`Real clock comparisons at this site, corrected and analysed exactly like a simulated survey: normal field at ${formatQuantity(exp.config.environment.latitude_deg, 'angle')}, terrain, tides, then the detection scan and the point-source fit.`}
        actions={
          <Link className={styles.note} to={`/experiments/${exp.id}`}>
            Configuration
          </Link>
        }
      />
      <div className={styles.layout}>
        <div className={styles.column}>
          <UploadForm experimentId={exp.id} sensorMode={exp.config.sensor.mode} uploading={data.uploading} failure={data.uploadFailure} onUpload={data.upload} />
          <section className={styles.panel} aria-labelledby="field-list-title">
            <h2 id="field-list-title">Datasets</h2>
            {data.listError ? (
              <ErrorState compact error={data.listError} actions={<Button onClick={data.reloadList}>Retry</Button>} />
            ) : data.list === null ? (
              <Skeleton height={80} label="Loading datasets" />
            ) : (
              <DatasetList list={data.list} selectedId={data.selected?.id ?? null} onSelect={data.select} currentHash={exp.configuration_hash} />
            )}
          </section>
        </div>
        <div className={styles.column}>
          {data.selected !== null ? (
            <SelectedDataset experiment={exp} data={data} />
          ) : (
            data.list !== null &&
            data.list.length === 0 && (
              <EmptyState
                title="No field data yet."
                message="Download the station template, fill in the measured frequency shifts and their uncertainties, and upload the file. The analysis runs automatically."
              />
            )
          )}
        </div>
      </div>
    </Page>
  )
}

export default function FieldDataPage() {
  const { experimentId } = useParams()
  if (experimentId === undefined) return <NoExperiment page="field-data" />
  return <FieldDataFor key={experimentId} experimentId={experimentId} />
}
