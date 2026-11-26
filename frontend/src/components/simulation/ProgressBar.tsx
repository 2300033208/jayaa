import { Wifi, WifiOff, RefreshCw } from 'lucide-react'
import type { ConnectionInfo, ConnectionState } from '../../api/socket'
import styles from './simulation.module.css'

interface ProgressProps {
  value: number
  label: string
  tone?: 'default' | 'critical' | 'muted'
}

export function ProgressBar({ value, label, tone = 'default' }: ProgressProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  return (
    <div
      className={styles.progress}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
    >
      <div className={styles.progressTrack}>
        <div className={styles.progressFill} data-tone={tone} style={{ transform: `scaleX(${clamped})` }} />
      </div>
    </div>
  )
}

const CONNECTION_TEXT: Record<ConnectionState, string> = {
  idle: 'Live stream idle',
  connecting: 'Connecting to live stream…',
  connected: 'Live stream connected',
  disconnected: 'Live stream interrupted',
  reconnecting: 'Reconnecting to live stream…',
  failed: 'Live stream unavailable',
  closed: 'Live stream closed',
}

export function ConnectionIndicator({ state, info }: { state: ConnectionState; info: ConnectionInfo }) {
  const tone = state === 'connected' ? 'good' : state === 'failed' ? 'critical' : state === 'idle' || state === 'closed' ? 'neutral' : 'warning'
  const Icon = state === 'connected' ? Wifi : state === 'reconnecting' || state === 'connecting' ? RefreshCw : WifiOff
  const attempt = (state === 'disconnected' || state === 'reconnecting') && info.attempt > 0 ? ` (attempt ${info.attempt})` : ''
  return (
    <span className={styles.connection} data-tone={tone} role="status" aria-live="polite" title={info.reason ?? undefined}>
      <Icon aria-hidden="true" />
      <span>
        {CONNECTION_TEXT[state]}
        {attempt}
      </span>
    </span>
  )
}
