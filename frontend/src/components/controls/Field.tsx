import { AlertCircle, AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import type { FieldMessages } from './fieldA11y'
import styles from './controls.module.css'

export type { FieldMessages } from './fieldA11y'

interface FieldProps extends FieldMessages {
  id: string
  label: string
  readout?: ReactNode
  children: ReactNode
  /** When the label targets a group (radio set), render it as a legend-like span instead of <label>. */
  asGroup?: boolean
}

export function Field({ id, label, readout, error, warning, hint, children, asGroup = false }: FieldProps) {
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        {asGroup ? (
          <span id={`${id}-label`} className={styles.label}>
            {label}
          </span>
        ) : (
          <label id={`${id}-label`} htmlFor={id} className={styles.label}>
            {label}
          </label>
        )}
        {readout !== undefined && (
          <span className={styles.readout} aria-hidden="true">
            {readout}
          </span>
        )}
      </div>
      {children}
      {error && (
        <p id={`${id}-error`} className={styles.error}>
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
      {!error && warning && (
        <p id={`${id}-warning`} className={styles.warning}>
          <AlertTriangle aria-hidden="true" />
          <span>{warning}</span>
        </p>
      )}
      {hint && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  )
}
