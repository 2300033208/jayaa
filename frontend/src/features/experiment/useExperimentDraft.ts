import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { ApiError } from '../../api/errors'
import { createExperiment, getDefaults, getExperiment, updateExperiment } from '../../api/experiments'
import type { Defaults, Experiment, FieldMessage } from '../../types/api'
import type { ExperimentConfig } from '../../types/config'
import { deepEqual } from '../../utils/misc'
import type { UserError } from '../../utils/userError'
import { userError } from '../../utils/userError'
import type { FieldErrors } from './validation'
import { validateConfig } from './validation'

interface State {
  status: 'loading' | 'ready' | 'error'
  loadError: UserError | null
  experiment: Experiment | null
  draft: ExperimentConfig | null
  /** Research scenarios offered when starting a new experiment (null when editing a saved one). */
  scenarios: Defaults['scenarios'] | null
  saving: boolean
  saveError: UserError | null
  serverFieldErrors: FieldMessage[]
}

type Action =
  | { type: 'loaded'; experiment: Experiment | null; config: ExperimentConfig; scenarios: Defaults['scenarios'] | null }
  | { type: 'load-failed'; error: UserError }
  | { type: 'edit'; update: (config: ExperimentConfig) => ExperimentConfig }
  | { type: 'save-start' }
  | { type: 'save-success'; experiment: Experiment }
  | { type: 'save-failed'; error: UserError; fields: FieldMessage[] }

const initial: State = {
  status: 'loading',
  loadError: null,
  experiment: null,
  draft: null,
  scenarios: null,
  saving: false,
  saveError: null,
  serverFieldErrors: [],
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loaded':
      return { ...initial, status: 'ready', experiment: action.experiment, draft: action.config, scenarios: action.scenarios }
    case 'load-failed':
      return { ...initial, status: 'error', loadError: action.error }
    case 'edit':
      if (state.draft === null) return state
      return { ...state, draft: action.update(state.draft), serverFieldErrors: [], saveError: null }
    case 'save-start':
      return { ...state, saving: true, saveError: null }
    case 'save-success':
      return { ...state, saving: false, experiment: action.experiment, draft: action.experiment.config, serverFieldErrors: [] }
    case 'save-failed':
      return { ...state, saving: false, saveError: action.error, serverFieldErrors: action.fields }
  }
}

export interface ExperimentDraft {
  state: State
  clientErrors: FieldErrors
  dirty: boolean
  edit: (update: (config: ExperimentConfig) => ExperimentConfig) => void
  save: () => Promise<Experiment | null>
  reload: () => void
}

/**
 * Loads (or initializes from engine defaults) and edits one experiment configuration.
 * Callers key the owning component by experiment id so a different experiment starts fresh.
 */
export function useExperimentDraft(experimentId: string | null): ExperimentDraft {
  const [state, dispatch] = useReducer(reducer, initial)
  const [reloadToken, bumpReload] = useReducer((n: number) => n + 1, 0)
  const saving = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const load = experimentId === null
      ? getDefaults(controller.signal).then((d) => ({ experiment: null, config: d.config, scenarios: d.scenarios }))
      : getExperiment(experimentId, controller.signal).then((e) => ({ experiment: e, config: e.config, scenarios: null }))
    load.then(
      (result) => {
        dispatch({ type: 'loaded', ...result })
      },
      (error: unknown) => {
        if (error instanceof ApiError && error.kind === 'aborted') return
        dispatch({ type: 'load-failed', error: userError(error, experimentId === null ? 'Defaults unavailable' : 'Experiment unavailable') })
      },
    )
    return () => {
      controller.abort()
    }
  }, [experimentId, reloadToken])

  const clientErrors = useMemo(() => (state.draft ? validateConfig(state.draft) : {}), [state.draft])
  const dirty = state.draft !== null && (state.experiment === null || !deepEqual(state.draft, state.experiment.config))

  const edit = useCallback((update: (config: ExperimentConfig) => ExperimentConfig) => {
    dispatch({ type: 'edit', update })
  }, [])

  const draft = state.draft
  const experiment = state.experiment
  const save = useCallback(async (): Promise<Experiment | null> => {
    // One save at a time; concurrent saves could otherwise race on the version number.
    if (saving.current || draft === null) return null
    if (Object.keys(validateConfig(draft)).length > 0) return null
    saving.current = true
    dispatch({ type: 'save-start' })
    try {
      const saved = experiment === null ? await createExperiment(draft) : await updateExperiment(experiment.id, draft, experiment.version)
      if (mounted.current) dispatch({ type: 'save-success', experiment: saved })
      return saved
    } catch (error) {
      if (mounted.current) {
        const fields = error instanceof ApiError ? error.fields : []
        dispatch({ type: 'save-failed', error: userError(error, 'The experiment could not be saved'), fields })
      }
      return null
    } finally {
      saving.current = false
    }
  }, [draft, experiment])

  return { state, clientErrors, dirty, edit, save, reload: bumpReload }
}
