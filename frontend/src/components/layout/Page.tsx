import type { ReactNode } from 'react'
import { cx } from '../../utils/misc'
import styles from './layout.module.css'

export function Page({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className={styles.page} aria-label={label} role="region">
      {children}
    </div>
  )
}

interface PageHeaderProps {
  title: string
  meta?: ReactNode
  actions?: ReactNode
  eyebrow?: string
}

export function PageHeader({ title, meta, actions, eyebrow }: PageHeaderProps) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageTitles}>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1 className={styles.pageTitle}>{title}</h1>
        {meta && <div className={styles.pageMeta}>{meta}</div>}
      </div>
      {actions && <div className={styles.pageActions}>{actions}</div>}
    </header>
  )
}

interface SectionProps {
  id: string
  number?: string
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
}

export function Section({ id, number, title, description, actions, children }: SectionProps) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-heading`}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitles}>
          {number && <span className={styles.sectionNumber}>{number}</span>}
          <h2 id={`${id}-heading`} className={styles.sectionTitle}>
            {title}
          </h2>
          {description && <p className={styles.sectionDescription}>{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(styles.panel, className)}>{children}</div>
}
