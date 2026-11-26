import { FlaskConical } from 'lucide-react'
import { Link, Navigate } from 'react-router'
import { lastExperimentId } from '../app/providers/shellContext'
import { EmptyState } from '../components/feedback/States'
import { Page, PageHeader } from '../components/layout/Page'
import styles from './pages.module.css'

/** Shown for /simulation, /analysis, /study and /field-data when no experiment is selected. */
export function NoExperiment({ page }: { page: 'simulation' | 'analysis' | 'study' | 'field-data' }) {
  const last = lastExperimentId()
  if (last !== null) return <Navigate to={`/experiments/${last}/${page}`} replace />
  const title = page === 'simulation' ? 'Simulation' : page === 'study' ? 'Study' : page === 'field-data' ? 'Field data' : 'Analysis'
  return (
    <Page label={title}>
      <PageHeader title={title} />
      <EmptyState
        icon={<FlaskConical />}
        title="No experiment selected."
        message={
          page === 'simulation'
            ? 'Create an experiment or open one from the history to run a simulation.'
            : page === 'study'
              ? 'Create an experiment or open one from the history to run a Monte Carlo study.'
              : page === 'field-data'
                ? 'Field data belong to an experiment, which defines the site and the corrections. Create one or open it from the history.'
                : 'Run a simulation for an experiment to analyse its results here.'
        }
        actions={
          <>
            <Link className={styles.primaryLink} to="/experiments/new">
              Create experiment
            </Link>
            <Link className={styles.secondaryLink} to="/history">
              Open history
            </Link>
          </>
        }
      />
    </Page>
  )
}
