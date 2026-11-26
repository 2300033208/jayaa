import { Navigate, Outlet, useLocation } from 'react-router'
import { useSession } from '../../app/providers/sessionContext'
import { Button } from '../controls/Button'
import { ErrorState, Skeleton } from '../feedback/States'
import styles from './layout.module.css'

/** Pages behind this route need a session; without one the user is sent to sign in and brought back. */
export function SessionGate() {
  const { state, retry } = useSession()
  const location = useLocation()
  if (state.status === 'loading') {
    return (
      <div className={styles.gate}>
        <Skeleton height={240} label="Checking your session" />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className={styles.gate}>
        <ErrorState
          error={state.error}
          actions={
            <Button variant="primary" onClick={retry}>
              Try again
            </Button>
          }
        />
      </div>
    )
  }
  if (state.status === 'signed_out') {
    const next = `${location.pathname}${location.search}${location.hash}`
    const params = new URLSearchParams()
    if (next !== '/' && state.reason !== 'signed_out') params.set('next', next)
    if (state.reason === 'expired') params.set('reason', 'expired')
    const query = params.toString()
    return <Navigate to={`/sign-in${query ? `?${query}` : ''}`} replace />
  }
  return <Outlet />
}
