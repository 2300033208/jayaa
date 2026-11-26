import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import styles from './feedback.module.css'

interface Props {
  /** Short name of the region, used in the fallback text. */
  region: string
  /** Replacement content; defaults to a compact message. */
  fallback?: ReactNode
  /** Changing any key resets the boundary (e.g. a new simulation id). */
  resetKeys?: readonly unknown[]
  children: ReactNode
}

interface State {
  error: Error | null
  keys: readonly unknown[]
}

function keysChanged(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]))
}

/** Contains a failing region so the rest of the application keeps working. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, keys: this.props.resetKeys ?? [] }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    const keys = props.resetKeys ?? []
    if (state.error !== null && keysChanged(keys, state.keys)) return { error: null, keys }
    if (keysChanged(keys, state.keys)) return { keys }
    return null
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.region}]`, error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback
    return (
      <div className={styles.boundary} role="alert">
        <strong>{this.props.region} unavailable.</strong>
        <span>This part of the interface failed to render. The rest of the application is unaffected.</span>
      </div>
    )
  }
}
