import type { ReactNode } from 'react'
import { ProvenanceTag, Quantity } from '../../components/scientific/Quantity'
import type { Provenance } from '../../components/scientific/Quantity'
import { ProgressBar } from '../../components/simulation/ProgressBar'
import { formatInteger } from '../../utils/format'
import { useController, useSim } from '../simulation/context'
import styles from './sensor.module.css'

function Metric({ label, provenance, value, detail }: { label: string; provenance?: Provenance; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>
        {label}
        {provenance && <ProvenanceTag kind={provenance} />}
      </span>
      <span className={styles.metricValue}>{value}</span>
      {detail && <span className={styles.metricDetail}>{detail}</span>}
    </div>
  )
}

/** Gravity anomaly · signal-to-noise · progress, all from engine data. */
export function MetricsStrip() {
  const controller = useController()
  const received = useSim((s) => s.received)
  const runningSnr = useSim((s) => s.runningSnr)
  const progress = useSim((s) => s.progress)
  const completed = useSim((s) => s.measurementsCompleted)
  const total = useSim((s) => s.measurementsTotal)
  const status = useSim((s) => s.status)
  const latest = received > 0 ? controller.buffer.row(received - 1) : null
  const noData = latest === null
  const reason = status === 'idle' ? 'No simulation has run yet.' : 'No measurement received yet.'

  return (
    <div className={styles.metrics} aria-label="Live measurement summary" role="group">
      <Metric
        label="Gravity anomaly at sensor"
        provenance="model"
        value={<Quantity value={latest?.gravity_anomaly_m_s2} kind="gravity_anomaly" unavailableReason={reason} />}
        detail="Noise-free field of the configured bodies"
      />
      <Metric
        label="Signal-to-noise (running)"
        provenance="derived"
        value={<Quantity value={noData ? null : runningSnr} kind="ratio" significant={2} unavailableReason={noData ? reason : 'The engine needs at least five measurements to establish a baseline.'} />}
        detail="Peak deviation from baseline ÷ sensor noise σ"
      />
      <Metric
        label="Measurements"
        value={
          <span className="mono">
            {formatInteger(completed)}
            {total !== null && ` / ${formatInteger(total)}`}
          </span>
        }
        detail={received === completed ? 'All received' : `${formatInteger(received)} received`}
      />
      <Metric
        label="Progress"
        value={<span className="mono">{Math.round(progress * 100)} %</span>}
        detail={<ProgressBar value={progress} label="Simulation progress" tone={status === 'failed' ? 'critical' : status === 'cancelled' ? 'muted' : 'default'} />}
      />
    </div>
  )
}
