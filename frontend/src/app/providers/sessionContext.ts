import { createContext, useContext } from 'react'
import type { User } from '../../types/field'
import type { UserError } from '../../utils/userError'

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed_out'; reason: 'none' | 'expired' | 'signed_out' }
  | { status: 'signed_in'; user: User }
  | { status: 'error'; error: UserError }

export interface SessionValue {
  state: SessionState
  /** Called after the engine accepted a sign-in or registration. */
  signedIn: (user: User) => void
  signOut: () => Promise<void>
  retry: () => void
}

export const SessionContext = createContext<SessionValue | null>(null)

export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (value === null) throw new Error('useSession must be used inside SessionProvider')
  return value
}

/** The signed-in user; only for components rendered behind the session gate. */
export function useUser(): User {
  const { state } = useSession()
  if (state.status !== 'signed_in') throw new Error('useUser requires a signed-in session')
  return state.user
}
