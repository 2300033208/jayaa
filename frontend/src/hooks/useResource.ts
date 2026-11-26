import { useEffect, useReducer, useRef, useState } from 'react'
import { isAbort } from '../api/errors'
import type { UserError } from '../utils/userError'
import { userError } from '../utils/userError'

export type Resource<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: UserError }

interface Entry<T> {
  key: string
  resource: Resource<T>
}

/**
 * Loads data for a key. Requests for an outdated key are aborted, and a response is only
 * accepted if it belongs to the current key, so stale data never replaces newer data.
 */
export function useResource<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  errorTitle: string,
): Resource<T> & { reload: () => void } {
  const [entry, setEntry] = useState<Entry<T> | null>(null)
  const [attempt, retry] = useReducer((n: number) => n + 1, 0)
  const requestKey = key === null ? null : `${key}#${attempt}`
  const latest = useRef({ load, errorTitle })

  useEffect(() => {
    latest.current = { load, errorTitle }
  })

  useEffect(() => {
    if (requestKey === null) return
    const controller = new AbortController()
    const { load: run, errorTitle: title } = latest.current
    run(controller.signal).then(
      (data) => {
        setEntry({ key: requestKey, resource: { status: 'ready', data } })
      },
      (error: unknown) => {
        if (isAbort(error)) return
        setEntry({ key: requestKey, resource: { status: 'error', error: userError(error, title) } })
      },
    )
    return () => {
      controller.abort()
    }
  }, [requestKey])

  let resource: Resource<T>
  if (requestKey === null) resource = { status: 'idle' }
  else if (entry?.key !== requestKey) resource = { status: 'loading' }
  else resource = entry.resource
  return { ...resource, reload: retry }
}
