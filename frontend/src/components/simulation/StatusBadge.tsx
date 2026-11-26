import { Ban, CheckCircle2, Circle, Loader2, PauseCircle, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SimulationStatus } from '../../features/simulation/stateMachine'
import { cx } from '../../utils/misc'
import styles from './simulation.module.css'

const META: Record<SimulationStatus, { label: string; tone: 'neutral' | 'info' | 'good' | 'warning' | 'critical'; icon: ReactNode }> = {
  idle: { label: 'Idle', tone: 'neutral', icon: <Circle aria-hidden="true" /> },
  validating: { label: 'Validating', tone: 'info', icon: <Loader2 className={styles.spin} aria-hidden="true" /> },
  starting: { label: 'Starting', tone: 'info', icon: <Loader2 className={styles.spin} aria-hidden="true" /> },
  running: { label: 'Running', tone: 'info', icon: <span className={styles.dot} aria-hidden="true" /> },
  paused: { label: 'Paused', tone: 'warning', icon: <PauseCircle aria-hidden="true" /> },
  cancelling: { label: 'Cancelling', tone: 'warning', icon: <Loader2 className={styles.spin} aria-hidden="true" /> },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: <Ban aria-hidden="true" /> },
  completed: { label: 'Completed', tone: 'good', icon: <CheckCircle2 aria-hidden="true" /> },
  failed: { label: 'Failed', tone: 'critical', icon: <XCircle aria-hidden="true" /> },
}

export function StatusBadge({ status, className }: { status: SimulationStatus; className?: string }) {
  const meta = META[status]
  return (
    <span className={cx(styles.badge, className)} data-tone={meta.tone} data-status={status}>
      {meta.icon}
      <span>{meta.label}</span>
    </span>
  )
}
