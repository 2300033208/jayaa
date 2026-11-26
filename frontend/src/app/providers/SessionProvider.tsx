import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getCurrentUser, signOut as signOutRequest } from '../../api/account'
import { onSessionLost } from '../../api/session'
import type { User } from '../../types/field'
import type { SessionState } from './sessionContext'
import { SessionContext } from './sessionContext'

const GUEST_USER: User = {
  id: '00000000000000000000000000000001',
  email: 'guest@simulator.local',
  display_name: 'Guest User',
  created_at: new Date().toISOString(),
}

/**
 * Who is signed in, as the engine reports it. Defaults to a guest session so no sign-in is required.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'signed_in', user: GUEST_USER })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getCurrentUser(controller.signal)
      .then((user) => {
        setState({ status: 'signed_in', user })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setState({ status: 'signed_in', user: GUEST_USER })
      })
    return () => {
      controller.abort()
    }
  }, [attempt])

  useEffect(
    () =>
      onSessionLost(() => {
        setState({ status: 'signed_in', user: GUEST_USER })
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
      setState({ status: 'signed_in', user: GUEST_USER })
    }
  }, [])

  const retry = useCallback(() => {
    setState({ status: 'signed_in', user: GUEST_USER })
    setAttempt((n) => n + 1)
  }, [])

  const value = useMemo(() => ({ state, signedIn, signOut, retry }), [state, signedIn, signOut, retry])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
