import { useEffect, useState } from 'react'
import { getSimulationResults } from '../../api/analysis'
import { isAbort } from '../../api/errors'
import { getDetectability, getExperiment, validateExperiment } from '../../api/experiments'
import type { DetectabilityStudy, Experiment, Results, ValidationResult } from '../../types/api'
import type { UserError } from '../../utils/userError'
import { userError } from '../../utils/userError'

/** One value of a comparison column: loaded, or unavailable with the reason. */
export type Part<T> = { ok: true; value: T } | { ok: false; error: UserError }

export interface ComparedExperiment {
  experiment: Experiment
  validation: Part<ValidationResult>
  detectability: Part<DetectabilityStudy>
  /** Null when the experiment has no completed run with results. */
  results: Part<Results> | null
}

export type ComparisonState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: UserError }
  | { status: 'ready'; items: ComparedExperiment[] }

async function part<T>(load: Promise<T>, title: string): Promise<Part<T>> {
  try {
    return { ok: true, value: await load }
  } catch (error) {
    if (isAbort(error)) throw error
    return { ok: false, error: userError(error, title) }
  }
}

/** Loads every compared experiment and, per experiment, the engine-derived values and latest results. */
export function useComparison(ids: readonly string[]): ComparisonState {
  const key = ids.join(',')
  const [state, setState] = useState<{ key: string; value: ComparisonState }>({ key: '', value: { status: 'idle' } })

  useEffect(() => {
    if (key === '') return
    const controller = new AbortController()
    const signal = controller.signal
    const load = async (id: string): Promise<ComparedExperiment> => {
      const experiment = await getExperiment(id, signal)
      const latest = experiment.latest_simulation
      const [validation, detectability, results] = await Promise.all([
        part(validateExperiment(experiment.config, signal), 'Engine validation unavailable'),
        part(getDetectability(experiment.config, signal), 'Detectability study unavailable'),
        latest !== null && latest.status === 'completed' && latest.results_available
          ? part(getSimulationResults(latest.id, signal), 'Results unavailable')
          : Promise.resolve(null),
      ])
      return { experiment, validation, detectability, results }
    }
    Promise.all(key.split(',').map(load)).then(
      (items) => {
        setState({ key, value: { status: 'ready', items } })
      },
      (error: unknown) => {
        if (!isAbort(error)) setState({ key, value: { status: 'error', error: userError(error, 'Comparison unavailable') } })
      },
    )
    return () => {
      controller.abort()
    }
  }, [key])

  if (key === '') return { status: 'idle' }
  return state.key === key ? state.value : { status: 'loading' }
}
