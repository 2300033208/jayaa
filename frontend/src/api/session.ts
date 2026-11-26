/*
 * Session loss notifications. The engine decides who is signed in (an HttpOnly cookie the page cannot
 * read); when any request or the live stream is refused with 401, the session provider is told so it
 * can send the user to the sign-in page with the reason.
 */

export type SessionLoss = 'session_expired' | 'not_authenticated'

type Listener = (reason: SessionLoss) => void

const listeners = new Set<Listener>()

export function onSessionLost(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function reportSessionLost(code: string): void {
  const reason: SessionLoss = code === 'session_expired' ? 'session_expired' : 'not_authenticated'
  for (const listener of [...listeners]) listener(reason)
}
