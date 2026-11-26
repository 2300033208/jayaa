import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getCurrentUser, signOut as signOutRequest } from '../../api/account'
import { ApiError } from '../../api/errors'
import { onSessionLost } from '../../api/session'
import type { User } from '../../types/field'
import { userError } from '../../utils/userError'
import type { SessionState } from './sessionContext'
import { SessionContext } from './sessionContext'

/**
 * Who is signed in, as the engine reports it. The session itself is an HttpOnly cookie the page cannot
 * read or forge; this provider only mirrors the engine's answer and reacts when a request is refused.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getCurrentUser(controller.signal)
      .then((user) => {
        setState({ status: 'signed_in', user })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && error.status === 401) setState({ status: 'signed_out', reason: 'none' })
        else setState({ status: 'error', error: userError(error, 'Could not check your session') })
      })
    return () => {
      controller.abort()
    }
  }, [attempt])

  useEffect(
    () =>
      onSessionLost((reason) => {
        setState((prev) =>
          prev.status === 'signed_in' ? { status: 'signed_out', reason: reason === 'session_expired' ? 'expired' : 'none' } : prev,
        )
      }),
    [],
  )

  const signedIn = useCallback((user: User) => {
    setState({ status: 'signed_in', user })
  }, [])

  const signOut = useCallback(async () => {
    try {
      await signOutRequest()
    } finally {
      // The cookie is cleared by the engine; locally the session ends either way.
      setState({ status: 'signed_out', reason: 'signed_out' })
    }
  }, [])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  const value = useMemo(() => ({ state, signedIn, signOut, retry }), [state, signedIn, signOut, retry])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
