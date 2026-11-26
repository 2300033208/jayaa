import { FlaskConical, Plus } from 'lucide-react'
import { Link } from 'react-router'
import { listExperiments } from '../api/experiments'
import { Button } from '../components/controls/Button'
import { EmptyState, ErrorState, Skeleton } from '../components/feedback/States'
import { Page } from '../components/layout/Page'
import type { ChainStep } from '../components/scientific/SignalChain'
import { SignalChain } from '../components/scientific/SignalChain'
import { RunStatus } from '../components/simulation/RunStatus'
import { useResource } from '../hooks/useResource'
import { formatDateTime } from '../utils/format'
import styles from './pages.module.css'

const STORY: ChainStep[] = [
  { id: 'mass', label: 'Subsurface mass', state: 'pending' },
  { id: 'field', label: 'Gravity field', state: 'pending' },
  { id: 'potential', label: 'Potential', state: 'pending' },
  { id: 'shift', label: 'Frequency shift', state: 'pending' },
  { id: 'sensor', label: 'Noisy sensor', state: 'pending' },
  { id: 'processing', label: 'Processing', state: 'pending' },
  { id: 'anomaly', label: 'Anomaly', state: 'pending' },
  { id: 'inversion', label: 'Inversion', state: 'pending' },
  { id: 'estimate', label: 'Estimate', state: 'pending' },
]

const RECENT = 5

export default function HomePage() {
  const experiments = useResource('recent', (signal) => listExperiments(RECENT, signal), 'Experiments unavailable')

  return (
    <Page label="Home">
      <section className={styles.hero} aria-labelledby="home-title">
        <h1 id="home-title" className={styles.heroTitle}>
          Atomic gravity
          <br />
          simulator
        </h1>
        <p className={styles.heroSub}>Simulate gravitational sensing using atomic-clock frequency measurements.</p>
        <div className={styles.heroActions}>
          <Link className={styles.primaryLink} to="/experiments/new">
            <Plus aria-hidden="true" /> New experiment
          </Link>
        </div>
      </section>

      <div className={styles.chain}>
        <SignalChain steps={STORY} label="What the simulator models" />
      </div>

      <section className={styles.recent} aria-labelledby="recent-title">
        <div className={styles.recentHeader}>
          <h2 id="recent-title" className="eyebrow">
            Recent experiments
          </h2>
          <Link to="/history">View all</Link>
        </div>
        {experiments.status === 'error' ? (
          <ErrorState compact headingLevel={3} error={experiments.error} actions={<Button size="sm" onClick={experiments.reload}>Retry</Button>} />
        ) : experiments.status !== 'ready' ? (
          <Skeleton height={160} label="Loading recent experiments" />
        ) : experiments.data.length === 0 ? (
          <EmptyState
            compact
            headingLevel={3}
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
          <ul className={styles.recentList}>
            {experiments.data.map((e) => (
              <li key={e.id} className={styles.recentItem}>
                <span className={styles.recentCode}>{e.code}</span>
                <Link to={`/experiments/${e.id}`} className={styles.recentName}>
                  {e.name}
                </Link>
                <RunStatus status={e.latest_simulation?.status ?? null} />
                <span className={styles.recentDate}>{formatDateTime(e.updated_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  )
}
