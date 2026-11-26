import { Ban, CheckCircle2, Circle, Loader2, PauseCircle, XCircle } from 'lucide-react'
import type { BackendStatus } from '../../types/api'
import styles from './simulation.module.css'

const META: Record<BackendStatus, { label: string; icon: typeof Circle; tone: string }> = {
  starting: { label: 'Starting', icon: Loader2, tone: 'info' },
  running: { label: 'Running', icon: Loader2, tone: 'info' },
  paused: { label: 'Paused', icon: PauseCircle, tone: 'warning' },
  cancelling: { label: 'Cancelling', icon: Loader2, tone: 'warning' },
  cancelled: { label: 'Cancelled', icon: Ban, tone: 'neutral' },
  completed: { label: 'Completed', icon: CheckCircle2, tone: 'good' },
  failed: { label: 'Failed', icon: XCircle, tone: 'critical' },
}

/** Compact status of a stored simulation run (icon + label, never color alone). */
export function RunStatus({ status }: { status: BackendStatus | null }) {
  if (status === null) {
    return (
      <span className={styles.runStatus} data-tone="neutral">
        <Circle aria-hidden="true" />
        Not run
      </span>
    )
  }
  const meta = META[status]
  const Icon = meta.icon
  return (
    <span className={styles.runStatus} data-tone={meta.tone}>
      <Icon aria-hidden="true" />
      {meta.label}
    </span>
  )
}
