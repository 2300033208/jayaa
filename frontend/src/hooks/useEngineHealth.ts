import { useEffect, useState } from 'react'
import { isAbort } from '../api/errors'
import { checkHealth } from '../api/experiments'

export type EngineHealth = { state: 'checking' } | { state: 'online'; version: string } | { state: 'offline' }

const INTERVAL_MS = 20_000

/** Polls the engine health endpoint while the tab is visible. Reports "offline" honestly. */
export function useEngineHealth(): EngineHealth {
  const [health, setHealth] = useState<EngineHealth>({ state: 'checking' })

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let controller: AbortController | null = null
    let disposed = false
    // A function (not a narrowed local) so the check is re-evaluated after each await.
    const isDisposed = () => disposed

    const schedule = () => {
      if (disposed) return
      timer = globalThis.setTimeout(() => {
        void check()
      }, INTERVAL_MS)
    }

    const check = async () => {
      if (disposed) return
      if (document.visibilityState === 'hidden') {
        schedule()
        return
      }
      controller?.abort()
      controller = new AbortController()
      try {
        const result = await checkHealth(controller.signal)
        if (!isDisposed()) setHealth({ state: 'online', version: result.engine_version })
      } catch (error) {
        // A superseded (aborted) check says nothing about the engine.
        if (isAbort(error)) return
        if (!isDisposed()) setHealth({ state: 'offline' })
      }
      schedule()
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        if (timer !== null) globalThis.clearTimeout(timer)
        void check()
      }
    }

    void check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      if (timer !== null) globalThis.clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return health
}
