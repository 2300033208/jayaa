import { useEffect, useState } from 'react'
import { isAbort } from '../../api/errors'
import { getInstrumentComparison } from '../../api/research'
import type { ExperimentConfig } from '../../types/config'
import type { GravimeterKind, InstrumentComparison } from '../../types/research'
import { stableStringify } from '../../utils/misc'
import type { UserError } from '../../utils/userError'
import { userError } from '../../utils/userError'

export type InstrumentState =
  | { status: 'idle' }
  | { status: 'pending'; previous: InstrumentComparison | null }
  | { status: 'done'; comparison: InstrumentComparison; key: string }
  | { status: 'error'; error: UserError }

const DEBOUNCE_MS = 700

/** The comparison ignores the name and inversion settings; editing those does not recompute it. */
function comparisonKey(config: ExperimentConfig, gravimeter: GravimeterKind): string {
  const { environment, bodies, sensor, noise, survey } = config
  return stableStringify({ environment, bodies, sensor, noise, survey, gravimeter })
}

/**
 * Asks the engine to compare the clock with a gravimeter on the same stations once the configuration is
 * valid and edits settle. Older requests are aborted; a result for an older input is never shown as current.
 */
export function useInstrumentComparison(config: ExperimentConfig | null, ready: boolean, gravimeter: GravimeterKind): InstrumentState {
  const [state, setState] = useState<InstrumentState>({ status: 'idle' })
  const key = config && ready ? comparisonKey(config, gravimeter) : null

  useEffect(() => {
    if (key === null || config === null) return
    const controller = new AbortController()
    const timer = globalThis.setTimeout(() => {
      setState((prev) => ({
        status: 'pending',
        previous: prev.status === 'done' ? prev.comparison : prev.status === 'pending' ? prev.previous : null,
      }))
      getInstrumentComparison(config, gravimeter, controller.signal).then(
        (comparison) => {
          setState({ status: 'done', comparison, key })
        },
        (error: unknown) => {
          if (isAbort(error)) return
          setState({ status: 'error', error: userError(error, 'Instrument comparison unavailable') })
        },
      )
    }, DEBOUNCE_MS)
    return () => {
      globalThis.clearTimeout(timer)
      controller.abort()
    }
    // The key captures every input of the comparison; the config object changes on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (key === null) return { status: 'idle' }
  if (state.status === 'done' && state.key !== key) return { status: 'pending', previous: state.comparison }
  return state
}
