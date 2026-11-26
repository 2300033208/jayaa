import { AlertOctagon, AlertTriangle, Info, Inbox } from 'lucide-react'
import type { ReactNode } from 'react'
import type { UserError } from '../../utils/userError'
import { cx } from '../../utils/misc'
import styles from './feedback.module.css'

interface EmptyStateProps {
  title: string
  message: ReactNode
  actions?: ReactNode
  icon?: ReactNode
  compact?: boolean
  headingLevel?: 2 | 3
}

export function EmptyState({ title, message, actions, icon, compact = false, headingLevel = 2 }: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <div className={cx(styles.state, compact && styles.compact)}>
      <span className={styles.icon} aria-hidden="true">
        {icon ?? <Inbox />}
      </span>
      <Heading>{title}</Heading>
      <p>{message}</p>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  )
}

interface ErrorStateProps {
  error: UserError
  actions?: ReactNode
  compact?: boolean
  headingLevel?: 2 | 3
}

/** Shows the actual reason reported by the engine; never a generic "something went wrong". */
export function ErrorState({ error, actions, compact = false, headingLevel = 2 }: ErrorStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <div className={cx(styles.state, styles.errorState, compact && styles.compact)} role="alert">
      <span className={styles.icon} aria-hidden="true">
        <AlertOctagon />
      </span>
      <Heading>{error.title}</Heading>
      {error.engineUnavailable ? (
        <p>{error.message}</p>
      ) : (
        <dl className={styles.reason}>
          <dt>Reason</dt>
          <dd>{error.message}</dd>
        </dl>
      )}
      {error.fields.length > 0 && (
        <ul className={styles.fieldList}>
          {error.fields.map((f) => (
            <li key={`${f.field}:${f.message}`}>{f.message}</li>
          ))}
        </ul>
      )}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  )
}

interface BannerProps {
  tone: 'info' | 'warning' | 'critical'
  title?: string
  children: ReactNode
  actions?: ReactNode
}

export function Banner({ tone, title, children, actions }: BannerProps) {
  const Icon = tone === 'info' ? Info : tone === 'warning' ? AlertTriangle : AlertOctagon
  return (
    <div className={cx(styles.banner, styles[tone])} role={tone === 'critical' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" />
      <div className={styles.bannerBody}>
        {title && <span className={styles.bannerTitle}>{title}</span>}
        <span>{children}</span>
      </div>
      {actions && <div className={styles.bannerActions}>{actions}</div>}
    </div>
  )
}

export function Skeleton({ height, width = '100%', label }: { height: number | string; width?: number | string; label: string }) {
  return <div className={styles.skeleton} style={{ height, width }} role="status" aria-label={label} />
}
