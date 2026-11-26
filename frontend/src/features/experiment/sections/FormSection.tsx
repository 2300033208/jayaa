import type { ReactNode } from 'react'
import styles from './form.module.css'

interface FormSectionProps {
  id: string
  step: number
  title: string
  description: ReactNode
  children: ReactNode
  actions?: ReactNode
}

export function FormSection({ id, step, title, description, children, actions }: FormSectionProps) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
      <header className={styles.sectionHeader}>
        <span className={styles.step} aria-hidden="true">
          {String(step).padStart(2, '0')}
        </span>
        <div>
          <h2 id={`${id}-title`} className={styles.sectionTitle}>
            {title}
          </h2>
          <p className={styles.sectionDescription}>{description}</p>
        </div>
        {actions && <div className={styles.sectionActions}>{actions}</div>}
      </header>
      <div className={styles.fields}>{children}</div>
    </section>
  )
}
