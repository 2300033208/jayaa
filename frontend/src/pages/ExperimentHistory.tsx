import { Activity, FlaskConical, LineChart, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { deleteExperiment, listExperiments } from '../api/experiments'
import { lastExperimentId, useShell } from '../app/providers/shellContext'
import { Button } from '../components/controls/Button'
import { ConfirmDialog } from '../components/feedback/ConfirmDialog'
import { EmptyState, ErrorState, Skeleton } from '../components/feedback/States'
import { Page, PageHeader } from '../components/layout/Page'
import { RunStatus } from '../components/simulation/RunStatus'
import { useResource } from '../hooks/useResource'
import type { ExperimentSummary } from '../types/api'
import { formatDateTime } from '../utils/format'
import { removeStored } from '../utils/storage'
import type { UserError } from '../utils/userError'
import { userError } from '../utils/userError'
import styles from './pages.module.css'

const PATTERN_LABEL = { serpentine: 'Serpentine grid', raster: 'Raster grid', profile: 'Profile' } as const

export default function ExperimentHistoryPage() {
  const [version, setVersion] = useState(0)
  const experiments = useResource(`history-${version}`, (signal) => listExperiments(200, signal), 'Experiment history unavailable')
  const [pendingDelete, setPendingDelete] = useState<ExperimentSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<UserError | null>(null)
  const { active, setActive } = useShell()

  const confirmDelete = async () => {
    if (pendingDelete === null || deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteExperiment(pendingDelete.id)
      if (lastExperimentId() === pendingDelete.id) removeStored('last-experiment')
      if (active?.id === pendingDelete.id) setActive(null)
      setPendingDelete(null)
      setVersion((v) => v + 1)
    } catch (error) {
      setDeleteError(userError(error, 'The experiment could not be deleted'))
      setPendingDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Page label="Experiment history">
      <PageHeader
        title="History"
        meta="All experiments stored by the simulation engine."
        actions={
          <Link className={styles.primaryLink} to="/experiments/new">
            <Plus aria-hidden="true" /> New experiment
          </Link>
        }
      />
      {deleteError && <ErrorState compact error={deleteError} />}
      {experiments.status === 'error' ? (
        <ErrorState error={experiments.error} actions={<Button onClick={experiments.reload}>Retry</Button>} />
      ) : experiments.status !== 'ready' ? (
        <Skeleton height={240} label="Loading experiment history" />
      ) : experiments.data.length === 0 ? (
        <EmptyState
          icon={<FlaskConical />}
          title="No experiments yet."
          message="Create your first simulation to begin."
          actions={
            <Link className={styles.primaryLink} to="/experiments/new">
              Create experiment
            </Link>
          }
        />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="visually-hidden">Experiments, most recently updated first</caption>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Name</th>
                <th scope="col" className={styles.secondaryCol}>Survey</th>
                <th scope="col" className={styles.secondaryCol}>Bodies</th>
                <th scope="col">Latest run</th>
                <th scope="col" className={styles.tertiaryCol}>Updated</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {experiments.data.map((e) => {
                const latest = e.latest_simulation
                const outdated = latest !== null && latest.status === 'completed' && latest.configuration_hash !== e.configuration_hash
                return (
                  <tr key={e.id}>
                    <td className={`mono ${styles.codeCell ?? ''}`}>{e.code}</td>
                    <td className={styles.nameCell}>
                      <Link to={`/experiments/${e.id}`}>{e.name}</Link>
                    </td>
                    <td className={styles.secondaryCol}>{PATTERN_LABEL[e.pattern]}</td>
                    <td className={`mono ${styles.secondaryCol ?? ''}`}>{e.body_count}</td>
                    <td className={styles.statusCell}>
                      <RunStatus status={latest?.status ?? null} />
                      {outdated && <span className={styles.staleTag}> · out of date</span>}
                    </td>
                    <td className={styles.tertiaryCol}>{formatDateTime(e.updated_at)}</td>
                    <td className={styles.actionsCell}>
                      <div className={styles.rowActions}>
                        <Link className={styles.secondaryLink} to={`/experiments/${e.id}/simulation`} aria-label={`Simulation for ${e.code}`}>
                          <Activity aria-hidden="true" />
                        </Link>
                        <Link className={styles.secondaryLink} to={`/experiments/${e.id}/analysis`} aria-label={`Analysis for ${e.code}`}>
                          <LineChart aria-hidden="true" />
                        </Link>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Trash2 />}
                          aria-label={`Delete ${e.code}`}
                          disabled={latest !== null && ['starting', 'running', 'paused', 'cancelling'].includes(latest.status)}
                          onClick={() => {
                            setPendingDelete(e)
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.code ?? 'experiment'}?`}
        confirmLabel="Delete experiment"
        tone="danger"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setPendingDelete(null)
        }}
      >
        “{pendingDelete?.name}” and all of its simulation results will be permanently removed from the engine.
      </ConfirmDialog>
    </Page>
  )
}
