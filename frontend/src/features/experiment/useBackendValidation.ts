import { useEffect, useState } from 'react'
import { isAbort } from '../../api/errors'
import { validateExperiment } from '../../api/experiments'
import type { ValidationResult } from '../../types/api'
import type { ExperimentConfig } from '../../types/config'
import { stableStringify } from '../../utils/misc'
import type { UserError } from '../../utils/userError'
import { userError } from '../../utils/userError'

export type BackendValidation =
  | { status: 'idle' }
  | { status: 'pending'; previous: ValidationResult | null }
  | { status: 'done'; result: ValidationResult; key: string }
  | { status: 'error'; error: UserError; previous: ValidationResult | null }

const DEBOUNCE_MS = 450

/**
 * Asks the engine to validate the draft after edits settle. Only drafts that pass client-side
 * validation are sent; older requests are aborted so a stale response can never overwrite a
 * newer one.
 */
export function useBackendValidation(config: ExperimentConfig | null, clientValid: boolean): BackendValidation {
  const [state, setState] = useState<BackendValidation>({ status: 'idle' })
  const key = config && clientValid ? stableStringify(config) : null

  useEffect(() => {
    if (key === null || config === null) return
    const controller = new AbortController()
    const timer = globalThis.setTimeout(() => {
      setState((prev) => ({ status: 'pending', previous: prev.status === 'done' ? prev.result : prev.status === 'idle' ? null : prev.previous }))
      validateExperiment(config, controller.signal).then(
        (result) => {
          setState({ status: 'done', result, key })
        },
        (error: unknown) => {
          if (isAbort(error)) return
          setState((prev) => ({
            status: 'error',
            error: userError(error, 'Engine validation unavailable'),
            previous: prev.status === 'done' ? prev.result : prev.status === 'idle' ? null : prev.previous,
          }))
        },
      )
    }, DEBOUNCE_MS)
    return () => {
      globalThis.clearTimeout(timer)
      controller.abort()
    }
  }, [key, config])

  if (key === null) return { status: 'idle' }
  // A result for an older configuration is never presented as current.
  if (state.status === 'done' && state.key !== key) return { status: 'pending', previous: state.result }
  return state
}
