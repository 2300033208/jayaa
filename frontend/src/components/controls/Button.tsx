import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from '../../utils/misc'
import styles from './controls.module.css'

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  icon?: ReactNode
  busy?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  busy = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(styles.button, styles[variant], size === 'sm' && styles.small, className)}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <span className={styles.spinner} aria-hidden="true" /> : icon}
      {children !== undefined && <span>{children}</span>}
    </button>
  )
}
