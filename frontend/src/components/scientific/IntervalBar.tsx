import type { QuantityKind } from '../../utils/units'
import { formatQuantity } from '../../utils/units'
import styles from './scientific.module.css'

interface IntervalBarProps {
  label: string
  estimate: number
  low: number
  high: number
  kind: QuantityKind
  confidence: number
  truth?: number | null
}

/**
 * Confidence interval as computed by the engine:  low ├──●──┤ high.
 * Rendered only when both bounds exist; the caller must not synthesize bounds.
 */
export function IntervalBar({ label, estimate, low, high, kind, confidence, truth }: IntervalBarProps) {
  const values = [low, high, estimate, ...(truth !== undefined && truth !== null ? [truth] : [])]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = (max - min) * 0.12 || Math.abs(estimate) * 0.05 || 1
  const lo = min - pad
  const hi = max + pad
  const pct = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`
  const level = `${Math.round(confidence * 100)} %`
  const description = `${label}: estimate ${formatQuantity(estimate, kind)}, ${level} interval ${formatQuantity(low, kind)} to ${formatQuantity(high, kind)}${
    truth !== undefined && truth !== null ? `, ground truth ${formatQuantity(truth, kind)}` : ''
  }.`
  return (
    <figure className={styles.interval} aria-label={description}>
      <div className={styles.intervalTrack} aria-hidden="true">
        <div className={styles.intervalAxis} />
        <div className={styles.intervalRange} style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }} />
        {truth !== undefined && truth !== null && <div className={styles.intervalTruth} style={{ left: pct(truth) }} />}
        <div className={styles.intervalPoint} style={{ left: pct(estimate) }} />
      </div>
      <figcaption className={styles.intervalLabels}>
        <span>{formatQuantity(low, kind)}</span>
        <strong>{formatQuantity(estimate, kind)}</strong>
        <span>{formatQuantity(high, kind)}</span>
      </figcaption>
    </figure>
  )
}
