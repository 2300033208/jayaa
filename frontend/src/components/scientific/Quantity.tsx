import type { ReactNode } from 'react'
import { UNAVAILABLE } from '../../utils/format'
import { cx } from '../../utils/misc'
import type { QuantityKind } from '../../utils/units'
import { formatQuantity } from '../../utils/units'
import styles from './scientific.module.css'

export type Provenance = 'measurement' | 'model' | 'estimate' | 'truth' | 'uncertainty' | 'config' | 'derived'

const PROVENANCE_LABEL: Record<Provenance, string> = {
  measurement: 'Simulated measurement',
  model: 'Forward model',
  estimate: 'Model estimate',
  truth: 'Ground truth',
  uncertainty: 'Uncertainty',
  config: 'Configured',
  derived: 'Derived',
}

const PROVENANCE_SHORT: Record<Provenance, string> = {
  measurement: 'Measured',
  model: 'Model',
  estimate: 'Estimate',
  truth: 'Truth',
  uncertainty: 'Uncertainty',
  config: 'Config',
  derived: 'Derived',
}

export function ProvenanceTag({ kind }: { kind: Provenance }) {
  return (
    <span className={styles.tag} data-kind={kind} title={PROVENANCE_LABEL[kind]}>
      {PROVENANCE_SHORT[kind]}
    </span>
  )
}

interface QuantityProps {
  value: number | null | undefined
  kind: QuantityKind
  significant?: number
  signed?: boolean
  /** Explanation shown when the value is unavailable. */
  unavailableReason?: string
  className?: string
}

export function Quantity({ value, kind, significant, signed, unavailableReason, className }: QuantityProps) {
  const text = formatQuantity(value, kind, { significant, signed })
  if (text === UNAVAILABLE) {
    const reason = unavailableReason ?? 'The engine did not provide this value.'
    return (
      <span className={cx(styles.unavailable, className)} title={reason}>
        {UNAVAILABLE}
        <span className="visually-hidden">: {reason}</span>
      </span>
    )
  }
  return <span className={cx(styles.value, className)}>{text}</span>
}

/** Explicit "Unavailable" with its reason, for values that are not numeric quantities. */
export function Unavailable({ reason }: { reason: string }) {
  return (
    <span className={styles.unavailable} title={reason}>
      {UNAVAILABLE}
      <span className="visually-hidden">: {reason}</span>
    </span>
  )
}

interface ReadoutProps {
  label: string
  provenance?: Provenance
  children: ReactNode
  detail?: ReactNode
  large?: boolean
}

export function Readout({ label, provenance, children, detail, large = false }: ReadoutProps) {
  return (
    <div className={cx(styles.readout, large && styles.large)}>
      <dt>
        <span>{label}</span>
        {provenance && <ProvenanceTag kind={provenance} />}
      </dt>
      <dd>{children}</dd>
      {detail !== undefined && <dd className={styles.detail}>{detail}</dd>}
    </div>
  )
}

export function Readouts({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cx(styles.readouts, className)}>{children}</dl>
}
