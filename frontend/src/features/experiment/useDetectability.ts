import { useEffect, useState } from 'react'
import { isAbort } from '../../api/errors'
import { getDetectability } from '../../api/experiments'
import type { DetectabilityStudy } from '../../types/api'
import type { ExperimentConfig } from '../../types/config'
import { stableStringify } from '../../utils/misc'
import type { UserError } from '../../utils/userError'
import { userError } from '../../utils/userError'

export type DetectabilityState =
  | { status: 'idle' }
  | { status: 'pending'; previous: DetectabilityStudy | null }
  | { status: 'done'; study: DetectabilityStudy; key: string }
  | { status: 'error'; error: UserError }

const DEBOUNCE_MS = 600

/** The study ignores the name and inversion settings; editing those does not recompute it. */
function studyKey(config: ExperimentConfig): string {
  const { environment, bodies, sensor, noise, survey } = config
  return stableStringify({ environment, bodies, sensor, noise, survey })
}

/**
 * Asks the engine for the detectability study once the configuration is valid and edits settle.
 * Older requests are aborted, and a study for an older configuration is never shown as current.
 */
export function useDetectability(config: ExperimentConfig | null, ready: boolean): DetectabilityState {
  const [state, setState] = useState<DetectabilityState>({ status: 'idle' })
  const key = config && ready ? studyKey(config) : null

  useEffect(() => {
    if (key === null || config === null) return
    const controller = new AbortController()
    const timer = globalThis.setTimeout(() => {
      setState((prev) => ({ status: 'pending', previous: prev.status === 'done' ? prev.study : prev.status === 'pending' ? prev.previous : null }))
      getDetectability(config, controller.signal).then(
        (study) => {
          setState({ status: 'done', study, key })
        },
        (error: unknown) => {
          if (isAbort(error)) return
          setState({ status: 'error', error: userError(error, 'Detectability study unavailable') })
        },
      )
    }, DEBOUNCE_MS)
    return () => {
      globalThis.clearTimeout(timer)
      controller.abort()
    }
    // The key captures every input of the study; the config object changes on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (key === null) return { status: 'idle' }
  if (state.status === 'done' && state.key !== key) return { status: 'pending', previous: state.study }
  return state
}
