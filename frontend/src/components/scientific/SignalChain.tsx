import { Fragment } from 'react'
import styles from './scientific.module.css'

export interface ChainStep {
  id: string
  label: string
  value?: string
  href?: string
  state: 'done' | 'active' | 'pending'
}

/**
 * The physical chain the simulator follows, from the buried mass to the reconstructed estimate.
 * Values are supplied by the caller from engine output; steps without data show no value.
 */
export function SignalChain({ steps, label }: { steps: readonly ChainStep[]; label: string }) {
  return (
    <ol className={styles.chain} aria-label={label}>
      {steps.map((step, i) => {
        const content = (
          <Fragment>
            <span className={styles.chainLabel}>{step.label}</span>
            {step.value !== undefined && <span className={styles.chainValue}>{step.value}</span>}
          </Fragment>
        )
        return (
          <li
            key={step.id}
            className={styles.chainStep}
            data-state={step.state}
            aria-current={step.state === 'active' ? 'step' : undefined}
          >
            {step.href ? <a href={step.href}>{content}</a> : content}
            {i < steps.length - 1 && (
              <span className={styles.chainArrow} aria-hidden="true">
                →
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
